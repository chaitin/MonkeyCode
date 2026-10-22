package billing

import (
	"context"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

func TestLedgerObservationDuringWrite(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	barrier, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer barrier.Release()
	if _, err = barrier.Exec(ctx, `SELECT pg_advisory_lock(78291,1)`); err != nil {
		t.Fatal(err)
	}
	defer barrier.Exec(context.Background(), `SELECT pg_advisory_unlock_all()`)
	ledgerExec(t, s, `CREATE FUNCTION test_pause_ledger_reverse() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN PERFORM pg_advisory_xact_lock(78291,1);RETURN NULL;END;$$;
 CREATE TRIGGER aaa_pause_reverse AFTER INSERT ON credit_ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION test_pause_ledger_reverse();`)
	writer, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Release()
	written := make(chan error, 1)
	go func() {
		_, err := writer.Exec(ctx, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
 VALUES($1,$2,'charge','model','观察期并发',-1,0,now())`, a.ID, user)
		written <- err
	}()
	for {
		var waiting bool
		err = s.pool.QueryRow(ctx, `SELECT coalesce((SELECT wait_event='advisory' FROM pg_stat_activity WHERE pid=$1),false)`, writer.Conn().PgConn().PID()).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(5 * time.Millisecond):
		}
	}
	type result struct {
		ok  bool
		err error
	}
	maintenance, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer maintenance.Release()
	finished := make(chan result, 1)
	go func() {
		var ok bool
		err := maintenance.QueryRow(ctx, `SELECT billing_finish_ledger_observation()`).Scan(&ok)
		finished <- result{ok, err}
	}()
	var outcome result
waitForMaintenance:
	for {
		select {
		case outcome = <-finished:
			break waitForMaintenance
		default:
		}
		var blocked bool
		if err = s.pool.QueryRow(ctx, `SELECT coalesce((SELECT wait_event_type='Lock' AND wait_event='relation' FROM pg_stat_activity WHERE pid=$1),false)`, maintenance.Conn().PgConn().PID()).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			// The original implementation waits for target while holding legacy.
			if _, err = barrier.Exec(ctx, `SELECT pg_advisory_unlock_all()`); err != nil {
				t.Fatal(err)
			}
			outcome = <-finished
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(5 * time.Millisecond):
		}
	}
	if _, err = barrier.Exec(ctx, `SELECT pg_advisory_unlock_all()`); err != nil {
		t.Fatal(err)
	}
	writeErr := <-written
	if writeErr != nil {
		t.Errorf("维护不能让账本写入死锁: %v", writeErr)
	}
	if outcome.err != nil || outcome.ok {
		t.Errorf("写入进行中应快速返回 false: %v %v", outcome.ok, outcome.err)
	}
	ledgerAssert(t, s)
}

func TestLedgerPartitionGuardCoversAllDefaultRows(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	at := time.Date(2034, 1, 2, 0, 0, 0, 0, time.UTC)
	ledgerInsert(t, s, a.ID, user, resource.ID(), "guard-a", 401, at, nil)
	ledgerInsert(t, s, a.ID, user, resource.ID(), "guard-b", 402, at.Add(time.Hour), nil)
	// Even an empty future week must validate DEFAULT on ATTACH. Guard the full queue.
	_, err = s.pool.Exec(t.Context(), `SELECT billing_create_ledger_week($1,1)`, at.Add(7*24*time.Hour))
	if err == nil {
		t.Fatal("默认队列超限时，不应继续对其他周执行自动 DDL")
	}
	var created bool
	if err = s.pool.QueryRow(t.Context(), `SELECT to_regclass('credit_ledger_entries_20340109') IS NOT NULL`).Scan(&created); err != nil || created {
		t.Fatalf("超限后不应创建分区: %v %v", created, err)
	}
	ledgerExec(t, s, `SELECT billing_create_ledger_week($1,0)`, at)
	ledgerAssert(t, s)
}

func TestLedgerOldSnapshotPreservesRollbackCopy(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.pool.BeginTx(t.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var users int
	if err = tx.QueryRow(t.Context(), `SELECT count(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	id := resource.ID()
	if _, err = tx.Exec(t.Context(), `INSERT INTO credit_ledger_entries(id,account_id,user_id,event_key,sequence,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
 VALUES($1,$2,$3,'old-snapshot',501,'charge','model','旧快照写入',-1,0,now())`, id, a.ID, user); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries_legacy WHERE id=$1`, id).Scan(&count); err != nil || count != 1 {
		t.Errorf("切换前已建立的快照也必须保留回滚副本: %d %v", count, err)
	}
	ledgerMigration(t, s, "down")
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries WHERE id=$1`, id).Scan(&count); err != nil || count != 1 {
		t.Errorf("回滚丢失已提交流水: %d %v", count, err)
	}
}

func TestLedgerRollbackRepairsObservationGap(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	// Reproduce a missing historical mirror without changing the observation flag.
	ledgerExec(t, s, `ALTER TABLE credit_ledger_entries DISABLE TRIGGER billing_ledger_reverse`)
	id := resource.ID()
	ledgerInsert(t, s, a.ID, user, id, "missing-backup", 601, time.Now(), nil)
	ledgerExec(t, s, `ALTER TABLE credit_ledger_entries ENABLE TRIGGER billing_ledger_reverse`)
	ledgerMigration(t, s, "down")
	var count int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries WHERE id=$1`, id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("不能仅凭观察期标志删除权威流水: %d %v", count, err)
	}
}

func TestLedgerDefaultMonitoringIsBounded(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ledgerCutover(t, s)
	ledgerExec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
 SELECT $1,$2,'charge','model','异常默认积压',-1,0,'2037-01-05 00:00+08'::timestamptz+i*interval '1 microsecond' FROM generate_series(1,10002) i`, a.ID, user)
	if _, err = s.pool.Exec(t.Context(), `SELECT billing_ensure_ledger_weeks('2037-03-02 00:00+08')`); err == nil {
		t.Fatal("总积压过大必须在自动 DDL 前停止")
	}
	count, err := sqlc.New(s.pool).LedgerDefaultCount(t.Context())
	if err != nil || count != 10001 {
		t.Fatalf("默认分区监控应有上限: %d %v", count, err)
	}
	ledgerAssert(t, s)
}
