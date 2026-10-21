package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func ledgerExec(t *testing.T, s *Service, query string, args ...any) {
	t.Helper()
	if _, err := s.pool.Exec(t.Context(), query, args...); err != nil {
		t.Fatal(err)
	}
}
func ledgerMigration(t *testing.T, s *Service, direction string) {
	t.Helper()
	b, err := os.ReadFile("../../migrations/000029_billing_ledger_weekly." + direction + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	ledgerExec(t, s, string(b))
}
func ledgerCutover(t *testing.T, s *Service) {
	t.Helper()
	for range 100 {
		n, err := sqlc.New(s.pool).CopyLedgerBatch(t.Context(), 2)
		if err != nil {
			t.Fatal(err)
		}
		if n <= 0 {
			break
		}
	}
	ok, err := sqlc.New(s.pool).CutoverLedger(t.Context())
	if err != nil || !ok {
		t.Fatalf("切换: %v %v", ok, err)
	}
}
func ledgerInsert(t *testing.T, s *Service, account, user, id, event string, sequence int64, at time.Time, reverse any) {
	t.Helper()
	ledgerExec(t, s, `INSERT INTO credit_ledger_entries(id,account_id,user_id,event_key,sequence,entry_type,category,item_name,credit_delta,balance_after,occurred_at,reverses_id)
        VALUES($1,$2,$3,$4,$5,'charge','model','周分区测试',-10,0,$6,$7)`, id, account, user, event, sequence, at, reverse)
}
func ledgerAssert(t *testing.T, s *Service) {
	t.Helper()
	var valid bool
	if err := s.pool.QueryRow(t.Context(), `SELECT
        (SELECT count(*) FROM credit_ledger_entries)=(SELECT count(*) FROM credit_ledger_entries_legacy)
        AND (SELECT count(*) FROM credit_ledger_entries)=(SELECT count(*) FROM credit_ledger_entry_keys)
        AND NOT EXISTS(SELECT 1 FROM credit_ledger_entries a LEFT JOIN credit_ledger_entries_legacy b ON a.id=b.id WHERE b.id IS NULL OR to_jsonb(a)<>to_jsonb(b))
        AND (SELECT coalesce(sum(credits),0) FROM stats_model_credit_hourly)=
        (SELECT coalesce(-sum(credit_delta),0) FROM credit_ledger_entries WHERE category='model' AND entry_type IN ('charge','refund'))`).Scan(&valid); err != nil || !valid {
		t.Fatalf("流水/镜像/登记/小时积分不一致: %v %v", valid, err)
	}
}

func TestLedgerWeeklyMigrationAndRollback(t *testing.T) {
	s, user, _ := fixture(t)
	ledgerMigration(t, s, "down")
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	charge := resource.ID()
	at := time.Date(2026, 12, 28, 0, 0, 0, 0, time.FixedZone("Shanghai", 8*3600))
	ledgerInsert(t, s, a.ID, user, charge, "weekly-charge", 101, at, nil)
	ledgerInsert(t, s, a.ID, user, resource.ID(), "weekly-sunday", 102, at.Add(-time.Microsecond), nil)
	ledgerInsert(t, s, a.ID, user, resource.ID(), "weekly-new-year", 103, at.Add(7*24*time.Hour), nil)
	ledgerMigration(t, s, "up")
	// A live refund can arrive before its historical charge has been backfilled.
	ledgerInsert(t, s, a.ID, user, resource.ID(), "weekly-refund", 104, at.Add(14*24*time.Hour), charge)
	if ok, err := sqlc.New(s.pool).CutoverLedger(t.Context()); err != nil || ok {
		t.Fatalf("不能提前切换: %v %v", ok, err)
	}
	ledgerCutover(t, s)
	ledgerAssert(t, s)
	for _, tc := range []struct{ event, table string }{
		{"weekly-charge", "credit_ledger_entries_20261228"},
		{"weekly-sunday", "credit_ledger_entries_20261221"},
		{"weekly-new-year", "credit_ledger_entries_20270104"},
	} {
		var name string
		if err := s.pool.QueryRow(t.Context(), `SELECT tableoid::regclass::text FROM credit_ledger_entries WHERE event_key=$1`, tc.event).Scan(&name); err != nil || name != tc.table {
			t.Fatalf("周边界 %s: %s %v", tc.event, name, err)
		}
	}
	// Both the new parent and stale statements addressing the legacy relation are safe.
	ledgerInsert(t, s, a.ID, user, resource.ID(), "after-cutover", 105, at.Add(time.Hour), nil)
	ledgerExec(t, s, `INSERT INTO credit_ledger_entries_legacy(account_id,user_id,event_key,sequence,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
        VALUES($1,$2,'stale-statement',106,'refund','model','旧连接退款',5,0,$3)`, a.ID, user, at.Add(time.Hour))
	ledgerAssert(t, s)
	for _, q := range []string{
		`INSERT INTO credit_ledger_entries SELECT id,account_id,user_id,session_id,entry_type,category,source_type,source_id,resource_type,resource_id,item_name,quantity,usage_unit,unit_credits,credit_delta,balance_after,external_reference,metadata,occurred_at+interval '7 days',created_at,transaction_id,event_key,sequence,user_name,user_email,group_id,mode,reverses_id FROM credit_ledger_entries WHERE event_key='weekly-charge'`,
		`UPDATE credit_ledger_entries SET item_name='篡改' WHERE event_key='weekly-charge'`,
		`DELETE FROM credit_ledger_entries WHERE event_key='weekly-charge'`,
		`DELETE FROM credit_ledger_entry_keys WHERE event_key='weekly-charge'`,
	} {
		if _, err := s.pool.Exec(t.Context(), q); err == nil {
			t.Fatal("应拒绝重复身份或篡改账本")
		}
	}
	for _, tc := range []struct {
		event string
		seq   int64
	}{{"weekly-charge", 200}, {"another-event", 101}} {
		_, err := s.pool.Exec(t.Context(), `INSERT INTO credit_ledger_entries(account_id,user_id,event_key,sequence,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
            VALUES($1,$2,$3,$4,'charge','model','跨周重复',-10,0,$5)`, a.ID, user, tc.event, tc.seq, at.Add(28*24*time.Hour))
		if err == nil {
			t.Fatal("跨周幂等键/账户序号必须全局唯一")
		}
	}
	ledgerAssert(t, s)
	ledgerMigration(t, s, "down")
	var count int
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries WHERE event_key IN ('after-cutover','stale-statement')`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("回滚丢失切换后流水: %d %v", count, err)
	}
	ledgerMigration(t, s, "up")
	ledgerCutover(t, s)
	ledgerAssert(t, s)
}

func TestLedgerWeeklyMaintenanceAndRollback(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	at := time.Date(2031, 1, 6, 3, 0, 0, 0, time.UTC)
	id := resource.ID()
	ledgerInsert(t, s, a.ID, user, id, "default-entry", 201, at, nil)
	ledgerInsert(t, s, a.ID, user, resource.ID(), "default-second", 203, at.Add(time.Hour), nil)
	// Large relocation is deferred instead of taking a long automatic table lock.
	if _, err := s.pool.Exec(t.Context(), `SELECT billing_create_ledger_week($1,1)`, at); err == nil {
		t.Fatal("默认队列超限应暂停自动 DDL")
	}
	var table string
	if err := s.pool.QueryRow(t.Context(), `SELECT tableoid::regclass::text FROM credit_ledger_entries WHERE id=$1`, id).Scan(&table); err != nil || table != "credit_ledger_entries_default" {
		t.Fatalf("默认分区: %s %v", table, err)
	}
	// Account updates preceding ledger inserts must not deadlock partition DDL.
	tx, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(t.Context(), `UPDATE credit_accounts SET balance=balance WHERE id=$1`, a.ID); err != nil {
		t.Fatal(err)
	}
	c, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	ok, err := sqlc.New(s.pool).EnsureLedgerWeeks(c, at)
	cancel()
	if err != nil || !ok {
		t.Fatalf("分区维护不应等待账户更新: %v %v", ok, err)
	}
	if err := tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(t.Context(), `SELECT tableoid::regclass::text FROM credit_ledger_entries WHERE id=$1`, id).Scan(&table); err != nil || table != "credit_ledger_entries_20310106" {
		t.Fatalf("迁出默认分区: %s %v", table, err)
	}
	ledgerAssert(t, s)
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			_, err := sqlc.New(s.pool).EnsureLedgerWeeks(t.Context(), at)
			if err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	var partitions int
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
        WHERE i.inhparent='credit_ledger_entries'::regclass AND c.relname BETWEEN 'credit_ledger_entries_20310106' AND 'credit_ledger_entries_20310303'`).Scan(&partitions); err != nil || partitions != 9 {
		t.Fatalf("当前及未来8周: %d %v", partitions, err)
	}
	transaction, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer transaction.Rollback(context.Background())
	if _, err := transaction.Exec(t.Context(), `INSERT INTO credit_ledger_entries(account_id,user_id,event_key,sequence,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
        VALUES($1,$2,'rolled-back',202,'charge','model','回滚',-10,0,$3)`, a.ID, user, at); err != nil {
		t.Fatal(err)
	}
	if err := transaction.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entry_keys WHERE event_key='rolled-back'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("登记应随流水回滚: %d %v", count, err)
	}
	ledgerAssert(t, s)
	conn, err := s.pool.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(t.Context(), `SET TIME ZONE 'America/New_York'; SELECT billing_ensure_ledger_weeks('2026-03-02 00:30+08')`); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(t.Context(), `SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
        WHERE i.inhparent='credit_ledger_entries'::regclass AND c.relname BETWEEN 'credit_ledger_entries_20260302' AND 'credit_ledger_entries_20260427'`).Scan(&partitions); err != nil || partitions != 9 {
		t.Fatalf("数据库会话夏令时不应遗漏上海自然周: %d %v", partitions, err)
	}
}

func TestLedgerWeeklyPartitionPruning(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	at := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	if _, err := sqlc.New(s.pool).EnsureLedgerWeeks(t.Context(), at); err != nil {
		t.Fatal(err)
	}
	ledgerInsert(t, s, a.ID, user, resource.ID(), "prune-first", 301, at, nil)
	ledgerInsert(t, s, a.ID, user, resource.ID(), "prune-last", 302, at.Add(7*24*time.Hour), nil)
	conn, err := s.pool.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(t.Context(), `SET plan_cache_mode=force_generic_plan; PREPARE ledger_pruning(timestamptz,timestamptz) AS
        SELECT count(*) FROM credit_ledger_entries WHERE occurred_at>=coalesce($1,'-infinity'::timestamptz) AND occurred_at<coalesce($2,'infinity'::timestamptz)`); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err := conn.QueryRow(t.Context(), `EXPLAIN (ANALYZE,FORMAT JSON) EXECUTE ledger_pruning('2026-10-19 00:00+08','2026-10-26 00:00+08')`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var plan any
	if err := json.Unmarshal(raw, &plan); err != nil {
		t.Fatal(err)
	}
	var visited []string
	var walk func(any)
	walk = func(v any) {
		switch n := v.(type) {
		case map[string]any:
			if name, ok := n["Relation Name"].(string); ok && strings.HasPrefix(name, "credit_ledger_entries_") && n["Actual Loops"].(float64) > 0 {
				visited = append(visited, name)
			}
			for _, c := range n {
				walk(c)
			}
		case []any:
			for _, c := range n {
				walk(c)
			}
		}
	}
	walk(plan)
	if len(visited) != 1 || visited[0] != "credit_ledger_entries_20261019" {
		t.Fatalf("通用计划应只扫描目标周: %v", visited)
	}
}

func TestLedgerWeeklySettlement(t *testing.T) {
	s, user, model := fixture(t)
	ledgerCutover(t, s)
	r, err := s.Begin(t.Context(), Request{UserID: user, ResourceID: model, Category: "model", IdempotencyKey: "weekly-real", RequestHash: "same"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Start(t.Context(), r.ID); err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if err = s.Finish(t.Context(), r.ID, Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: "succeeded"}); err != nil {
			t.Fatal(err)
		}
	}
	a, err := s.Account(t.Context(), user)
	if err != nil || a.Balance != amountText("9998.52") {
		t.Fatalf("分区后结算余额: %v %v", a, err)
	}
	q := sqlc.New(s.pool)
	entries, err := q.PartitionedTransactionEntries(t.Context(), &r.ID)
	if err != nil || len(entries) != 1 {
		t.Fatalf("按全局登记定位交易明细: %d %v", len(entries), err)
	}
	original, err := q.TransactionEntries(t.Context(), &r.ID)
	if err != nil || len(original) != 1 || string(entries[0]) != string(original[0]) {
		t.Fatalf("交易明细契约变化: %v", err)
	}
	var event, id string
	if err = s.pool.QueryRow(t.Context(), `SELECT event_key,id FROM credit_ledger_entry_keys WHERE transaction_id=$1`, r.ID).Scan(&event, &id); err != nil {
		t.Fatal(err)
	}
	exists, err := q.EventExists(t.Context(), &event)
	if err != nil || !exists {
		t.Fatal("幂等查询失败", err)
	}
	found, err := q.EventID(t.Context(), &event)
	if err != nil || found != id {
		t.Fatal("事件定位失败", err)
	}
	adjustment, err := q.GetAdjustment(t.Context(), &event)
	if err != nil || amountText(adjustment.CreditDelta) != amountText("-1.48") {
		t.Fatalf("积分定位查询: %v %v", adjustment, err)
	}
	ledgerAssert(t, s)
}

func TestLedgerWeeklyFinishObservationAndRollback(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	ledgerExec(t, s, `SELECT billing_finish_ledger_observation()`)
	id := resource.ID()
	ledgerInsert(t, s, a.ID, user, id, "after-observation", 901, time.Now(), nil)
	var oldCount int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries_legacy WHERE id=$1`, id).Scan(&oldCount); err != nil || oldCount != 0 {
		t.Fatal("结束观察期后应停止旧副本增长", err)
	}
	ledgerMigration(t, s, "down")
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries WHERE id=$1`, id).Scan(&oldCount); err != nil || oldCount != 1 {
		t.Fatal("观察期后回滚应先补齐新增流水", err)
	}
}

func TestLedgerWeeklyWorkerStartup(t *testing.T) {
	s, user, _ := fixture(t)
	if _, err := s.Account(t.Context(), user); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { defer close(done); s.runLedgerPartitions(ctx) }()
	defer func() { cancel(); <-done }()
	deadline := time.After(10 * time.Second)
	for {
		partitioned, err := sqlc.New(s.pool).LedgerPartitioned(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if partitioned {
			break
		}
		select {
		case <-deadline:
			t.Fatal("启动后后台迁移没有完成")
		case <-time.After(10 * time.Millisecond):
		}
	}
	ledgerAssert(t, s)
}

func TestLedgerWeeklyConcurrentCutover(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var workers sync.WaitGroup
	for w := range 4 {
		workers.Go(func() {
			for i := range 50 {
				_, err := s.pool.Exec(ctx, `INSERT INTO credit_ledger_entries(account_id,user_id,event_key,sequence,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
            VALUES($1,$2,$3,$4,'charge','model','并发切换',-1,0,now())`, a.ID, user, fmt.Sprintf("concurrent-%d-%d", w, i), int64(1000+w*50+i))
				if err != nil {
					t.Error(err)
					return
				}
			}
		})
	}
	ledgerCutover(t, s)
	workers.Wait()
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger_entries WHERE event_key LIKE 'concurrent-%'`).Scan(&count); err != nil || count != 200 {
		t.Fatalf("并发切换丢失流水: %d %v", count, err)
	}
	ledgerAssert(t, s)
}
