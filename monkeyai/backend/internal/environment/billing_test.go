package environment

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

func meterFixture(t *testing.T, credits string) (*Service, string, string, *time.Time) {
	t.Helper()
	s, user, host := fixture(t)
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO users(id,name,email,role) VALUES(gen_random_uuid(),'计费管理员',gen_random_uuid()::text || '@example.com','admin')`); err != nil {
		t.Fatal(err)
	}
	charges := billing.NewService(s.pool)
	if err := charges.Initialize(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(t.Context(), `UPDATE settings SET value=jsonb_set(value,'{root_credits}',$1::jsonb) WHERE key='billing'`, credits); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(BillingConfig{Enabled: true, CPU: 3600_000000})
	if _, err := s.pool.Exec(t.Context(), `UPDATE host_environment_configs SET billing=$1`, b); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return at }
	return s.WithBilling(charges), user, host, &at
}

func cost(t *testing.T, s *Service, user, want string, count int) {
	t.Helper()
	var amount string
	var n int
	if err := s.pool.QueryRow(t.Context(), `SELECT COALESCE(sum(-credit_delta),0)::text,count(*) FROM credit_ledger_entries WHERE user_id=$1 AND category='environment'`, user).Scan(&amount, &n); err != nil {
		t.Fatal(err)
	}
	a, err := billing.ParseAmount(amount)
	if err != nil || a.String() != want || n != count {
		t.Fatalf("费用=%s 笔数=%d，期望%s/%d，错误=%v", amount, n, want, count, err)
	}
}
func balance(t *testing.T, s *Service, user string) string {
	t.Helper()
	var amount string
	if err := s.pool.QueryRow(t.Context(), `SELECT balance::text FROM credit_accounts WHERE user_id=$1 ORDER BY period_start_at DESC LIMIT 1`, user).Scan(&amount); err != nil {
		t.Fatal(err)
	}
	a, err := billing.ParseAmount(amount)
	if err != nil {
		t.Fatal(err)
	}
	return a.String()
}
func settle(t *testing.T, s *Service, closedOnly bool) {
	t.Helper()
	if err := s.settleBilling(t.Context(), closedOnly); err != nil {
		t.Fatal(err)
	}
}

func TestComputeMeterLifecycleAndIdempotency(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"计费环境", "create-meter"})
	if err != nil {
		t.Fatal(err)
	}
	*at = at.Add(30 * time.Second)
	settle(t, s, false)
	cost(t, s, user, "0", 0)
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(60 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	settle(t, s, false)
	cost(t, s, user, "60", 1)
	*at = at.Add(15 * time.Second)
	stopped, err := s.Change(t.Context(), &user, e.Environment.ID, "stopped", Change{1, "stop-meter"})
	if err != nil {
		t.Fatal(err)
	}
	*at = at.Add(15 * time.Second)
	syncState(t, s, host, observe(stopped.Environment, "stopped"))
	settle(t, s, true)
	cost(t, s, user, "90", 2)
	*at = at.Add(time.Hour)
	settle(t, s, false)
	cost(t, s, user, "90", 2)
	if got := balance(t, s, user); got != "9910" {
		t.Fatalf("余额=%s", got)
	}
}

func TestComputeBalanceExhaustionStopsAndChargesTail(t *testing.T) {
	s, user, host, at := meterFixture(t, "5")
	e, err := s.Create(t.Context(), user, Creation{"余额环境", "create-debt"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(10 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	q := sqlc.New(s.pool)
	stopped, err := q.GetEnvironment(t.Context(), sqlc.GetEnvironmentParams{ID: e.Environment.ID})
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Desired != "stopped" || stopped.BillingStopReason != "insufficient_credits" || stopped.Generation != 2 || stopped.Phase != "running" {
		t.Fatalf("余额耗尽未正确停止：%+v", stopped)
	}
	if got := balance(t, s, user); got != "-5" {
		t.Fatalf("尾费应实收，余额=%s", got)
	}
	_, err = s.Create(t.Context(), user, Creation{"不应创建", "create-denied"})
	var denied *failure
	if !errors.As(err, &denied) || denied.code != "insufficient_credits" {
		t.Fatalf("负余额准入=%v", err)
	}
	*at = at.Add(2 * time.Second)
	syncState(t, s, host, Observation{EnvironmentID: stopped.ID, InstanceID: stopped.InstanceID, Generation: stopped.Generation, Phase: "stopped"})
	settle(t, s, true)
	cost(t, s, user, "12", 2)
	if got := balance(t, s, user); got != "-7" {
		t.Fatalf("停机尾费未结清，余额=%s", got)
	}
}

func TestComputeUnknownIntervalIsNeverBackfilled(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"断线环境", "create-gap"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(30 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(time.Hour)
	settle(t, s, false)
	cost(t, s, user, "30", 1)
	// 模拟服务重启后重新接管同一持久计量记录。
	s = NewService(s.pool).WithBilling(billing.NewService(s.pool))
	s.now = func() time.Time { return *at }
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(20 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	cost(t, s, user, "50", 2)
}

func TestComputeConcurrentSettlementAndRollback(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"并发环境", "create-concurrent"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(60 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	if _, err = s.pool.Exec(t.Context(), `CREATE FUNCTION reject_compute() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.category='environment' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_compute BEFORE INSERT ON credit_ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_compute()`); err != nil {
		t.Fatal(err)
	}
	if err = s.settleBilling(t.Context(), false); err == nil {
		t.Fatal("未触发账务回滚")
	}
	cost(t, s, user, "0", 0)
	if got := balance(t, s, user); got != "10000" {
		t.Fatalf("失败事务提前扣费：%s", got)
	}
	if _, err = s.pool.Exec(t.Context(), `DROP TRIGGER reject_compute ON credit_ledger_entries`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Go(func() { errs <- s.settleBilling(context.Background(), false) })
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	cost(t, s, user, "60", 1)
}

func TestComputeSplitsAccountCycle(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	zone, _ := time.LoadLocation("Asia/Shanghai")
	now := at.In(zone)
	monday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone).AddDate(0, 0, (8-int(now.Weekday()))%7)
	if !monday.After(*at) {
		monday = monday.AddDate(0, 0, 7)
	}
	*at = monday.Add(-30 * time.Second).UTC()
	e, err := s.Create(t.Context(), user, Creation{"跨期环境", "create-cycle"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(60 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	cost(t, s, user, "60", 2)
	var accounts int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_accounts WHERE user_id=$1 AND balance=9970`, user).Scan(&accounts); err != nil {
		t.Fatal(err)
	}
	if accounts != 2 {
		t.Fatalf("跨周期未拆分：%d", accounts)
	}
}

func TestComputeConfigChangeAndDisable(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"调价环境", "create-price"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(30 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	var setup SetupView
	if err = s.transaction(t.Context(), func(q *sqlc.Queries) error {
		var err error
		setup, err = s.setupView(t.Context(), q, host, s.pool)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	pricing := BillingConfig{Enabled: true, CPU: 7200_000000}
	saved, err := s.saveSetup(t.Context(), host, Setup{Resource: *setup.Resource, MaxEnvironments: setup.MaxEnvironments, UserMaxEnvironments: setup.UserMaxEnvironments, Billing: &pricing})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Billing != pricing {
		t.Fatal("价格配置未更新")
	}
	settle(t, s, true)
	cost(t, s, user, "30", 1)
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(10 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	cost(t, s, user, "50", 2)
	pricing.Enabled = false
	if _, err = s.saveSetup(t.Context(), host, Setup{Resource: *saved.Resource, MaxEnvironments: saved.MaxEnvironments, UserMaxEnvironments: saved.UserMaxEnvironments, Billing: &pricing}); err != nil {
		t.Fatal(err)
	}
	*at = at.Add(60 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	cost(t, s, user, "50", 2)
	current, err := sqlc.New(s.pool).GetEnvironment(t.Context(), sqlc.GetEnvironmentParams{ID: e.Environment.ID})
	if err != nil || current.Desired != "running" {
		t.Fatalf("关闭收费不应停止环境：%v", err)
	}
}

func TestComputeBudgetIncludesAllRunningEnvironments(t *testing.T) {
	s, user, host, at := meterFixture(t, "600")
	a, err := s.Create(t.Context(), user, Creation{"环境一", "budget-a"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Create(t.Context(), user, Creation{"环境二", "budget-b"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(a.Environment, "running"), observe(b.Environment, "running"))
	*at = at.Add(60 * time.Second)
	syncState(t, s, host, observe(a.Environment, "running"), observe(b.Environment, "running"))
	settle(t, s, false)
	budget, enabled, err := s.billingBudget(t.Context(), user)
	if err != nil || !enabled || budget == nil {
		t.Fatalf("预算查询失败：%v", err)
	}
	if budget.Balance.String() != "480" || budget.RunningEnvironments != 2 || budget.RemainingSeconds == nil || *budget.RemainingSeconds != 240 || !budget.LowBalance {
		t.Fatalf("用户合计预算错误：%+v", budget)
	}
	views := []View{a.Environment, b.Environment}
	if err = s.billingViews(t.Context(), views); err != nil {
		t.Fatal(err)
	}
	if views[0].Billing == nil || views[0].Billing.HourlyCredits.String() != "3600" || views[0].Billing.SettledCredits != "60.000000" {
		t.Fatalf("计费展示信息错误：%+v", views[0].Billing)
	}
}

func TestComputeMinuteRoundingAccumulatesExactly(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	pricing, _ := json.Marshal(BillingConfig{Enabled: true, CPU: 100000})
	if _, err := s.pool.Exec(t.Context(), `UPDATE host_environment_configs SET billing=$1`, pricing); err != nil {
		t.Fatal(err)
	}
	e, err := s.Create(t.Context(), user, Creation{"小额计费", "create-small"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	for range 60 {
		*at = at.Add(60 * time.Second)
		syncState(t, s, host, observe(e.Environment, "running"))
		settle(t, s, false)
	}
	cost(t, s, user, "0.1", 60)
}

func TestComputeRejectsInvalidPricingAndRemoteMode(t *testing.T) {
	s, _, host, _ := meterFixture(t, "10000")
	var setup SetupView
	if err := s.transaction(t.Context(), func(q *sqlc.Queries) error {
		var err error
		setup, err = s.setupView(t.Context(), q, host, s.pool)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, pricing := range []BillingConfig{{Enabled: true, CPU: -1}, {Enabled: true, CPU: 1000000000000_000000}} {
		if _, err := s.saveSetup(t.Context(), host, Setup{Resource: *setup.Resource, MaxEnvironments: setup.MaxEnvironments, UserMaxEnvironments: setup.UserMaxEnvironments, Billing: &pricing}); err == nil {
			t.Fatal("接受非法环境价格")
		}
	}
	if _, err := s.pool.Exec(t.Context(), `UPDATE settings SET value=jsonb_set(value,'{charging_mode}','"remote"'::jsonb) WHERE key='billing'`); err != nil {
		t.Fatal(err)
	}
	pricing := BillingConfig{Enabled: true, CPU: 1_000000}
	if _, err := s.saveSetup(t.Context(), host, Setup{Resource: *setup.Resource, MaxEnvironments: setup.MaxEnvironments, UserMaxEnvironments: setup.UserMaxEnvironments, Billing: &pricing}); err == nil {
		t.Fatal("远程模式静默开启了本地环境收费")
	}
}

func TestComputeDeletedUserStillSettlesHistoricalUsage(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"历史结算", "create-deleted-owner"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(30 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	if _, err = s.pool.Exec(t.Context(), "UPDATE users SET deleted_at=now() WHERE id=$1", user); err != nil {
		t.Fatal(err)
	}
	settle(t, s, false)
	cost(t, s, user, "30", 1)
	if got := balance(t, s, user); got != "9970" {
		t.Fatalf("删除用户导致历史费用丢失：%s", got)
	}
	if _, err = s.Create(t.Context(), user, Creation{"不应创建", "deleted-admission"}); err == nil {
		t.Fatal("已删除用户仍能新建环境")
	}
	syncState(t, s, host)
	current, err := sqlc.New(s.pool).GetEnvironment(t.Context(), sqlc.GetEnvironmentParams{ID: e.Environment.ID})
	if err != nil || current.Desired != "stopped" || current.Phase != "running" {
		t.Fatalf("删除用户未触发停止或过早释放资源：%v", err)
	}
	*at = at.Add(8 * 24 * time.Hour)
	budget, _, err := s.billingBudget(t.Context(), user)
	if err != nil || budget != nil {
		t.Fatalf("已删除用户创建了新周期预算：%v %+v", err, budget)
	}
	var accounts int
	if err = s.pool.QueryRow(t.Context(), "SELECT count(*) FROM credit_accounts WHERE user_id=$1", user).Scan(&accounts); err != nil || accounts != 1 {
		t.Fatalf("历史结算为删除用户补发了新周期账户：%d %v", accounts, err)
	}
}

func TestComputeInspectionFailureDoesNotExtendBilling(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"巡检失败", "create-inspection-failure"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(30 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(10 * time.Second)
	failed := observe(e.Environment, "failed")
	failed.Reason = "inspect_failed"
	syncState(t, s, host, failed)
	settle(t, s, true)
	cost(t, s, user, "30", 1)
	current, err := sqlc.New(s.pool).GetEnvironment(t.Context(), sqlc.GetEnvironmentParams{ID: e.Environment.ID})
	if err != nil || current.Phase != "failed" {
		t.Fatalf("不能把巡检失败当作已停止：%v", err)
	}
	views := []View{view(current)}
	if err = s.billingViews(t.Context(), views); err != nil || views[0].Billing == nil || views[0].Billing.State != "unknown" {
		t.Fatalf("巡检失败应展示未确认计费状态：%v", err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	cost(t, s, user, "30", 1)
}

func TestComputePriceUsesExactDecimal(t *testing.T) {
	for _, tt := range []struct {
		cpu, memory, seconds        int64
		cpuPrice, memoryPrice, want string
	}{
		{1000, 2 << 30, 3600, "0.1", "0.025", "0.15"},
		{100, 1 << 28, 60, "0.1", "0.025", "0.000271"},
		{1000, 1 << 30, 1800, "0.000001", "0", "0.000001"},
	} {
		cpu, _ := billing.ParseAmount(tt.cpuPrice)
		memory, _ := billing.ParseAmount(tt.memoryPrice)
		got, err := computePrice(BillingConfig{CPU: cpu, Memory: memory}, tt.cpu, tt.memory, tt.seconds)
		if err != nil || got.String() != tt.want {
			t.Fatalf("计价=%s 期望=%s 错误=%v", got, tt.want, err)
		}
	}
}
