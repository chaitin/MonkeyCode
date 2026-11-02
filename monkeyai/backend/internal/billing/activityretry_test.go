package billing

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestActivityWeeklyLockRetry(t *testing.T) {
	s, _, _ := fixture(t)
	activityCutover(t, s)
	for _, name := range activityTables {
		t.Run(name, func(t *testing.T) {
			for i, mode := range []string{"ACCESS SHARE", "ROW EXCLUSIVE"} {
				t.Run(mode, func(t *testing.T) {
					at := time.Date(2031, 1, 6, 0, 0, 0, 0, time.UTC).AddDate(0, 0, i*70)
					lock, err := s.pool.Begin(t.Context())
					if err != nil {
						t.Fatal(err)
					}
					defer lock.Rollback(context.Background())
					if _, err = lock.Exec(t.Context(), "LOCK TABLE "+name+" IN "+mode+" MODE"); err != nil {
						t.Fatal(err)
					}
					ctx, cancel := context.WithTimeout(t.Context(), time.Second)
					defer cancel()
					maintenance, err := s.pool.Begin(ctx)
					if err != nil {
						t.Fatal(err)
					}
					defer maintenance.Rollback(context.Background())
					ready, err := sqlc.New(maintenance).EnsureActivityWeeks(ctx, sqlc.EnsureActivityWeeksParams{TableName: name, AtTime: at})
					if err != nil || ready {
						t.Fatalf("读写锁竞争应快速返回 false: %v %v", ready, err)
					}
					if err = maintenance.Commit(ctx); err != nil {
						t.Fatalf("锁竞争不应中止调用方事务: %v", err)
					}
					if err = lock.Rollback(t.Context()); err != nil {
						t.Fatal(err)
					}
					ready, err = sqlc.New(s.pool).EnsureActivityWeeks(t.Context(), sqlc.EnsureActivityWeeksParams{TableName: name, AtTime: at})
					if err != nil || !ready {
						t.Fatalf("锁释放后应补齐当前及未来八周: %v %v", ready, err)
					}
					var count int
					if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
 WHERE i.inhparent=$1::regclass AND c.relname BETWEEN $2 AND $3`, name, name+"_"+at.Format("20060102"), name+"_"+at.AddDate(0, 0, 56).Format("20060102")).Scan(&count); err != nil || count != 9 {
						t.Fatalf("预建分区不完整: %d %v", count, err)
					}
				})
			}
		})
	}
}

func TestActivityWeeklyLockRetryPreservesErrors(t *testing.T) {
	s, _, _ := fixture(t)
	ledgerExec(t, s, `CREATE TABLE model_calls_20310106(id uuid)`)
	_, err := sqlc.New(s.pool).EnsureActivityWeeks(t.Context(), sqlc.EnsureActivityWeeksParams{
		TableName: "model_calls", AtTime: time.Date(2031, 1, 6, 0, 0, 0, 0, time.UTC),
	})
	if pg, ok := errors.AsType[*pgconn.PgError](err); !ok || pg.Code != "P0001" {
		t.Fatalf("分区名称冲突必须继续报错: %v", err)
	}
}

func TestActivityWeeklyWorkerRetryInterval(t *testing.T) {
	s, _, _ := fixture(t)
	ledgerExec(t, s, `CREATE TABLE activity_retry_checks(table_name text PRIMARY KEY, checks integer NOT NULL, copies integer NOT NULL DEFAULT 0);
 CREATE OR REPLACE FUNCTION billing_ensure_activity_weeks(kind text,at_time timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$
 BEGIN
     INSERT INTO activity_retry_checks(table_name,checks) VALUES(kind,1)
     ON CONFLICT(table_name) DO UPDATE SET checks=activity_retry_checks.checks+1;
     RETURN false;
 END; $$;
 CREATE OR REPLACE FUNCTION billing_copy_activity_batch(kind text,batch_size integer) RETURNS integer LANGUAGE plpgsql AS $$
 BEGIN
     UPDATE activity_retry_checks SET copies=copies+1 WHERE table_name=kind;
     RETURN 1;
 END; $$;`)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { defer close(done); s.runActivityPartitions(ctx) }()
	defer func() { cancel(); <-done }()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		var tables, checks, copies int
		if err := s.pool.QueryRow(t.Context(), `SELECT count(*),coalesce(max(checks),0),coalesce(min(copies),0) FROM activity_retry_checks`).Scan(&tables, &checks, &copies); err != nil {
			t.Fatal(err)
		}
		if checks > 1 {
			t.Fatalf("快速回填不应触发重复预建: %d", checks)
		}
		if tables == len(activityTables) && copies >= 10 {
			return
		}
		select {
		case <-deadline.C:
			t.Fatal("后台回填未持续执行")
		case <-tick.C:
		}
	}
}

func TestActivityWeeklyLockRetryMigrationRollback(t *testing.T) {
	s, _, _ := fixture(t)
	activityCutover(t, s)
	lock, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(context.Background())
	if _, err = lock.Exec(t.Context(), `LOCK TABLE model_calls IN ACCESS SHARE MODE`); err != nil {
		t.Fatal(err)
	}
	params := sqlc.EnsureActivityWeeksParams{TableName: "model_calls", AtTime: time.Date(2031, 1, 6, 0, 0, 0, 0, time.UTC)}
	for _, direction := range []string{"down", "up"} {
		b, err := os.ReadFile("../../migrations/000035_billing_activity_lock_retry." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		ledgerExec(t, s, string(b))
		ready, err := sqlc.New(s.pool).EnsureActivityWeeks(t.Context(), params)
		if direction == "down" {
			if pg, ok := errors.AsType[*pgconn.PgError](err); !ok || pg.Code != "55P03" {
				t.Fatalf("回滚应恢复原锁竞争错误: %v", err)
			}
		} else if err != nil || ready {
			t.Fatalf("重新升级应恢复可重试状态: %v %v", ready, err)
		}
	}
}
