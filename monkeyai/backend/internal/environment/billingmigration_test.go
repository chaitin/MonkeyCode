package environment

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

func cloudMigration(t *testing.T, s *Service, direction string) error {
	t.Helper()
	raw, err := os.ReadFile("../../migrations/000040_cloud_environments." + direction + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.pool.Exec(t.Context(), string(raw))
	return err
}

func TestCloudMigrationRejectsActiveEnvironmentRemoval(t *testing.T) {
	s, user, host, _ := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"迁移保护", "create-migration"})
	if err != nil {
		t.Fatal(err)
	}
	var before string
	if err = s.pool.QueryRow(t.Context(), "SELECT spec::text FROM environments WHERE id=$1", e.Environment.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err = cloudMigration(t, s, "down"); err == nil || !strings.Contains(err.Error(), "confirmed deleted") {
		t.Fatalf("未确认删除的环境仍允许回退：%v", err)
	}
	var after string
	if err = s.pool.QueryRow(t.Context(), "SELECT spec::text FROM environments WHERE id=$1", e.Environment.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	var a, b any
	if json.Unmarshal([]byte(before), &a) != nil || json.Unmarshal([]byte(after), &b) != nil {
		t.Fatal("环境快照损坏")
	}
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	if string(left) != string(right) {
		t.Fatal("迁移回退改变持久环境快照")
	}
	if err = cloudMigration(t, s, "up"); err != nil {
		t.Fatal(err)
	}
	d, err := sqlc.New(s.pool).HostSetup(t.Context(), host)
	if err != nil {
		t.Fatal(err)
	}
	pricing, err := decodeBilling(d.Billing)
	if err != nil || !pricing.Enabled {
		t.Fatal("重放覆盖已有宿主计费配置", err)
	}
	if got := balance(t, s, user); got != "10000" {
		t.Fatalf("迁移改变账户余额：%s", got)
	}
}

func TestCloudMigrationRoundtripPreservesBusinessData(t *testing.T) {
	s, user, _, _ := meterFixture(t, "10000")
	if err := s.transactionWithTx(t.Context(), func(_ *sqlc.Queries, tx pgx.Tx) error {
		_, err := s.credits.ComputeAccount(t.Context(), tx, user, s.now())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := cloudMigration(t, s, "down"); err != nil {
		t.Fatal(err)
	}
	if got := balance(t, s, user); got != "10000" {
		t.Fatal("回退改变已有账户余额", got)
	}
	if err := cloudMigration(t, s, "up"); err != nil {
		t.Fatal(err)
	}
	id := resource.ID()
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO hosts(id,user_id,name,architecture,version) VALUES($1,$2,'fresh','amd64','v1')`, id, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO host_environment_configs(host_id) VALUES($1)`, id); err != nil {
		t.Fatal(err)
	}
	d, err := sqlc.New(s.pool).HostSetup(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := decodeBilling(d.Billing)
	if err != nil || cfg.Enabled {
		t.Fatal("重新创建云环境未默认关闭收费", err)
	}
	if got := balance(t, s, user); got != "10000" {
		t.Fatal("重新升级改变已有账户余额", got)
	}
}

func TestComputeMigrationRejectsFinancialHistoryRemoval(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"账务保护", "create-financial"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(30 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	if err = cloudMigration(t, s, "up"); err != nil {
		t.Fatal(err)
	}
	if err = cloudMigration(t, s, "down"); err == nil || !strings.Contains(err.Error(), "归档") {
		t.Fatalf("存在环境账务仍允许删除计费结构：%v", err)
	}
	cost(t, s, user, "30", 1)
	if got := balance(t, s, user); got != "9970" {
		t.Fatalf("回退失败改变余额：%s", got)
	}
}

func TestComputeContinuesAfterLedgerAndActivityCutover(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"分区切换", "create-cutover"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(e.Environment, "running"))
	*at = at.Add(10 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	for _, kind := range []string{"billing_transactions", "model_calls", "mcp_tool_calls", "image_calls", "video_calls"} {
		for range 100 {
			var n int
			if err = s.pool.QueryRow(t.Context(), "SELECT billing_copy_activity_batch($1,100)", kind).Scan(&n); err != nil {
				t.Fatal(err)
			}
			if n <= 0 {
				break
			}
		}
		var ok bool
		if err = s.pool.QueryRow(t.Context(), "SELECT billing_cutover_activity($1)", kind).Scan(&ok); err != nil || !ok {
			t.Fatalf("切换%s：%v", kind, err)
		}
	}
	for range 100 {
		var n int
		if err = s.pool.QueryRow(t.Context(), "SELECT billing_copy_ledger_batch(100)").Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n <= 0 {
			break
		}
	}
	var ok bool
	if err = s.pool.QueryRow(t.Context(), "SELECT billing_cutover_ledger()").Scan(&ok); err != nil || !ok {
		t.Fatalf("账本切换失败：%v", err)
	}
	*at = at.Add(10 * time.Second)
	syncState(t, s, host, observe(e.Environment, "running"))
	settle(t, s, false)
	settle(t, s, false)
	cost(t, s, user, "20", 2)
	if got := balance(t, s, user); got != "9980" {
		t.Fatalf("分区后重复或遗漏扣费：%s", got)
	}
}

func TestComputeWaitsForUsableRuntime(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"等待可用", "create-ready"})
	if err != nil {
		t.Fatal(err)
	}
	confirm := func(usable bool) {
		t.Helper()
		if err := s.transactionWithTx(t.Context(), func(q *sqlc.Queries, tx pgx.Tx) error {
			env, err := q.LockHostEnvironment(t.Context(), sqlc.LockHostEnvironmentParams{ID: e.Environment.ID, HostID: host})
			if err != nil {
				return err
			}
			return s.observeBilling(t.Context(), q, tx, env, "running", usable)
		}); err != nil {
			t.Fatal(err)
		}
	}
	confirm(false)
	*at = at.Add(time.Hour)
	confirm(false)
	settle(t, s, false)
	cost(t, s, user, "0", 0)
	confirm(true)
	*at = at.Add(30 * time.Second)
	confirm(true)
	settle(t, s, false)
	cost(t, s, user, "30", 1)
}
