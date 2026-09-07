package billing

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"git.in.chaitin.net/ai/baizhiyun/opensdk"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAmountAndPricing(t *testing.T) {
	for _, v := range []string{"0", "0.000001", "1.48", "-123.456789", "999999999.123456"} {
		a, err := ParseAmount(v)
		if err != nil || a.String() != v {
			t.Fatalf("%s: %s %v", v, a, err)
		}
	}
	for _, v := range []string{"NaN", "1e3", "1.0000001", "9223372036854.775808", ""} {
		if _, err := ParseAmount(v); err == nil {
			t.Fatalf("应拒绝 %s", v)
		}
	}
	p := Price{Input: amountText("100"), Cached: amountText("20"), Output: amountText("400"), Multiplier: amountText("1")}
	a, err := priceTokens(10000, 4000, 2000, p)
	if err != nil || a.String() != "1.48" {
		t.Fatalf("计算错误 %s %v", a, err)
	}
	if _, err = priceTokens(1, 2, 3, p); err == nil {
		t.Fatal("缓存超出输入必须拒绝")
	}
	if quotaAmount(amountText("1.481"), true) != 149 || quotaAmount(amountText("1.481"), false) != 148 {
		t.Fatal("远程单位或舍入错误")
	}
}
func TestPeriods(t *testing.T) {
	for _, tc := range []struct{ cycle, at, start, end string }{{"monthly", "2028-02-29T15:59:00Z", "2028-01-31T16:00:00Z", "2028-02-29T16:00:00Z"}, {"weekly", "2026-09-06T12:00:00Z", "2026-08-30T16:00:00Z", "2026-09-06T16:00:00Z"}, {"daily", "2026-09-07T16:00:00Z", "2026-09-07T16:00:00Z", "2026-09-08T16:00:00Z"}} {
		now, _ := time.Parse(time.RFC3339, tc.at)
		start, end := (Policy{Cycle: tc.cycle}).period(now)
		if start.Format(time.RFC3339) != tc.start || end.Format(time.RFC3339) != tc.end {
			t.Fatalf("%s: %s %s", tc.cycle, start, end)
		}
	}
}
func fixture(t *testing.T) (*Service, string, string) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行计费数据库集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "billing_test_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 16
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(b)); err != nil {
			t.Fatalf("迁移 %s: %v", path, err)
		}
	}
	user, model := resource.ID(), resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'测试用户','billing@example.com','admin')`, user); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id) VALUES($1,'system','测试模型','test','openai_chat_completions','https://example.com','test','{"context_window_tokens":100000,"max_output_tokens":10000}',$2)`, model, user); err != nil {
		t.Fatal(err)
	}
	s := NewService(pool)
	s.now = func() time.Time { return time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC) }
	if err = s.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	p := defaultPolicy()
	p.Enabled = true
	setPolicy(t, s, p)
	return s, user, model
}
func setPolicy(t *testing.T, s *Service, p Policy) {
	t.Helper()
	b, _ := json.Marshal(p)
	if _, err := s.pool.Exec(t.Context(), `UPDATE settings SET value=$1 WHERE key='billing'`, b); err != nil {
		t.Fatal(err)
	}
}
func TestSettlementAndPeriodIsolation(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	r, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model", IdempotencyKey: "request-one", RequestHash: "same"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model", IdempotencyKey: "request-one", RequestHash: "same"}); err == nil {
		t.Fatal("重复请求不能重新执行")
	}
	if err = s.Start(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	old, err := s.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC) }
	next, err := s.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if next.ID == old.ID {
		t.Fatal("未新建周期账户")
	}
	u := Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: "succeeded"}
	for range 3 {
		if err = s.Finish(ctx, r.ID, u); err != nil {
			t.Fatal(err)
		}
	}
	var balance, frozen string
	var count int
	if err = s.pool.QueryRow(ctx, `SELECT balance::text,frozen::text FROM credit_accounts WHERE id=$1`, old.ID).Scan(&balance, &frozen); err != nil {
		t.Fatal(err)
	}
	if amountText(balance) != amountText("14998.52") || amountText(frozen) != 0 {
		t.Fatalf("旧账户: %s %s", balance, frozen)
	}
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger_entries WHERE transaction_id=$1`, r.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("流水数量 %d %v", count, err)
	}
	next, err = s.Account(ctx, user)
	if err != nil || next.Balance != amountText("15000") {
		t.Fatal("迟到结算污染新周期", next, err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE credit_ledger_entries SET item_name='篡改' WHERE transaction_id=$1`, r.ID); err == nil {
		t.Fatal("历史流水不可修改")
	}
	var nullable bool
	if err = s.pool.QueryRow(ctx, `SELECT session_id IS NULL FROM model_calls WHERE id=$1`, r.ID).Scan(&nullable); err != nil || !nullable {
		t.Fatal("独立调用必须可落库", err)
	}
}
func TestConcurrentReservations(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	p := defaultPolicy()
	p.Enabled = true
	p.Input = 0
	p.Cached = 0
	p.Output = amountText("1000000")
	setPolicy(t, s, p)
	if _, err := s.pool.Exec(ctx, `UPDATE models SET advanced_config='{"context_window_tokens":10,"max_output_tokens":4}' WHERE id=$1`, model); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE settings SET value=jsonb_set(value,'{root_credits}','"10"') WHERE key='billing'`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	ids := make(chan string, 20)
	failures := make(chan error, 20)
	for range 20 {
		wg.Go(func() {
			r, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
			if err == nil {
				ids <- r.ID
			} else if !errors.Is(err, insufficient) {
				failures <- err
			}
		})
	}
	wg.Wait()
	close(ids)
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	if len(ids) != 2 {
		t.Fatalf("应该只有两笔获准执行，实际 %d", len(ids))
	}
	a, err := s.Account(ctx, user)
	if err != nil || a.Frozen != amountText("8") || a.Available != amountText("2") {
		t.Fatal(a, err)
	}
	for id := range ids {
		if err = s.Release(ctx, id, "not_sent"); err != nil {
			t.Fatal(err)
		}
	}
	a, err = s.Account(ctx, user)
	if err != nil || a.Frozen != 0 || a.Balance != amountText("10") {
		t.Fatal(a, err)
	}
}
func TestQuotaInheritanceAndNoRefill(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	g := resource.ID()
	_, err := s.pool.Exec(ctx, `INSERT INTO groups(id,parent_id,name) VALUES($1,NULL,'研发');`, g)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES('group',$1,77,$2)`, g, user)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE users SET billing_group_id=$2 WHERE id=$1`, user, g)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.Account(ctx, user)
	if err != nil || a.Quota != amountText("77") {
		t.Fatal(a, err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE billing_quotas SET credits_per_cycle=88 WHERE group_id=$1`, g)
	if err != nil {
		t.Fatal(err)
	}
	a, err = s.Account(ctx, user)
	if err != nil || a.Quota != amountText("77") {
		t.Fatal("配置变更不应重发当期额度", a, err)
	}
}

type walletStub struct {
	mu                sync.Mutex
	createErr         error
	failConfirm       bool
	creates, confirms []string
}

func (w *walletStub) GetUserByID(_ context.Context, id string) (*opensdk.User, error) {
	return &opensdk.User{ID: id}, nil
}
func (w *walletStub) GetUserCreditBalance(context.Context, string) (*opensdk.UserCreditBalance, error) {
	return &opensdk.UserCreditBalance{AvailableCreditCents: 1000000}, nil
}
func (w *walletStub) CreateBillingCharge(_ context.Context, _ string, r *opensdk.CreateBillingChargeReq) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.creates = append(w.creates, r.BizID)
	return w.createErr
}
func (w *walletStub) ConfirmBillingCharge(_ context.Context, r *opensdk.ConfirmBillingChargeReq) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.confirms = append(w.confirms, r.BizID)
	if w.failConfirm {
		return errors.New("连接中断")
	}
	return nil
}
func TestRemoteConfirmationRecovery(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	stub := &walletStub{failConfirm: true}
	s.WithWallet(&Wallet{Client: stub, Environment: "dev", AppID: 4})
	if err := s.BindWallet(ctx, user, user, "1001"); err != nil {
		t.Fatal(err)
	}
	p := defaultPolicy()
	p.Enabled = true
	p.Mode = "remote"
	setPolicy(t, s, p)
	r, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Start(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Finish(ctx, r.ID, Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: "succeeded"}); err == nil {
		t.Fatal("远程确认失败应保持待结算")
	}
	a, err := s.Account(ctx, user)
	if err != nil || a.Balance != amountText("15000") || a.Frozen == 0 {
		t.Fatal(a, err)
	}
	stub.failConfirm = false
	for range 3 {
		if err = s.Settle(ctx, r.ID); err != nil {
			t.Fatal(err)
		}
	}
	if len(stub.creates) != 1 || len(stub.confirms) != 2 || stub.creates[0] != stub.confirms[1] {
		t.Fatalf("远程业务 ID 未保持幂等: %+v", stub)
	}
	a, err = s.Account(ctx, user)
	if err != nil || a.Balance != amountText("14998.52") || a.Frozen != 0 {
		t.Fatal(a, err)
	}
}

func TestUnknownAndRejectedRemoteReservation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		frozen bool
	}{
		{"明确余额不足", opensdk.ErrInsufficientBalance, false},
		{"远程返回前连接中断", errors.New("connection lost"), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, user, model := fixture(t)
			ctx := t.Context()
			stub := &walletStub{createErr: tc.err}
			s.WithWallet(&Wallet{Client: stub, Environment: "dev", AppID: 4})
			if err := s.BindWallet(ctx, user, user, "1002"); err != nil {
				t.Fatal(err)
			}
			p := defaultPolicy()
			p.Enabled = true
			p.Mode = "remote"
			setPolicy(t, s, p)
			if _, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"}); err == nil {
				t.Fatal("不应放行上游")
			}
			a, err := s.Account(ctx, user)
			if err != nil {
				t.Fatal(err)
			}
			if (a.Frozen > 0) != tc.frozen || a.Balance != amountText("15000") {
				t.Fatalf("错误释放或扣款: %+v", a)
			}
		})
	}
}

func TestMissingUsageKeepsReservation(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	r, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Start(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Finish(ctx, r.ID, Usage{Result: "failed"}); err != nil {
		t.Fatal(err)
	}
	var state string
	if err = s.pool.QueryRow(ctx, `SELECT status FROM billing_transactions WHERE id=$1`, r.ID).Scan(&state); err != nil || state != "unknown" {
		t.Fatal(state, err)
	}
	a, err := s.Account(ctx, user)
	if err != nil || a.Frozen <= 0 || a.Balance != amountText("15000") {
		t.Fatal(a, err)
	}
	if err = s.Finish(ctx, r.ID, Usage{Known: true, Input: 10000, Cached: 4000, Output: 2000, Result: "failed"}); err != nil {
		t.Fatal(err)
	}
	a, err = s.Account(ctx, user)
	if err != nil || a.Frozen != 0 || a.Balance != amountText("14998.52") {
		t.Fatal(a, err)
	}
	var input int64
	if err = s.pool.QueryRow(ctx, `SELECT input_tokens FROM model_calls WHERE id=$1`, r.ID).Scan(&input); err != nil || input != 10000 {
		t.Fatal("核查未同步调用事实", input, err)
	}
}

func TestLegacyQuotaMigration(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要 PostgreSQL")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_legacy_billing_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	apply := func(path string) {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	apply("../../migrations/000001_initial_create_schema.up.sql")
	id := resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'旧用户','legacy@example.com','admin')`, id); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"root_credits": 222, "quota_overrides": map[string]string{id: "33", "member-01": "44"}, "remote_billing_api_key": "legacy-secret"})
	if _, err = pool.Exec(ctx, `INSERT INTO settings(key,value,updated_by_user_id) VALUES('billing',$1,$2)`, raw, id); err != nil {
		t.Fatal(err)
	}
	apply("../../migrations/000002_billing_create_transactions.up.sql")
	var credits string
	var issues int
	if err = pool.QueryRow(ctx, `SELECT credits_per_cycle::text FROM billing_quotas WHERE user_id=$1`, id).Scan(&credits); err != nil || amountText(credits) != amountText("33") {
		t.Fatal(credits, err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM billing_migration_issues`).Scan(&issues); err != nil || issues != 1 {
		t.Fatal(issues, err)
	}
	var secret bool
	if err = pool.QueryRow(ctx, `SELECT value ? 'remote_billing_api_key' FROM settings WHERE key='billing'`).Scan(&secret); err != nil || secret {
		t.Fatal("旧密钥未移除", err)
	}
}

func TestQuotaChangePreservesUnopenedAccount(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err = s.PreserveAccounts(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE settings SET value=jsonb_set(value,'{root_credits}','"1"') WHERE key='billing'`); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	a, err := s.Account(ctx, user)
	if err != nil || a.Quota != amountText("15000") {
		t.Fatal("首次访问不应提前使用下周期额度", a, err)
	}
}
