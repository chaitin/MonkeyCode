package session

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
)

func waitTurnBlocked(t *testing.T, s *Service, pid uint32) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var blocked bool
		if err := s.pool.QueryRow(t.Context(), `SELECT cardinality(pg_blocking_pids($1))>0`, pid).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("worker did not reach the parent lock")
}
func TestTurnMonthlyConcurrentPurge(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnMigration(t, s, "down")
	at := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	id := turnSeedSession(t, s, user, at)
	for i := 1; i <= 4; i++ {
		turnSeed(t, s, id, i, at.AddDate(0, i, 0))
	}
	turnMigration(t, s, "up")
	writer, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(context.Background())
	if _, err = writer.Exec(t.Context(), `SELECT id FROM sessions WHERE id=$1 FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	conn, err := s.pool.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	result := make(chan error, 1)
	go func() {
		var n int
		err := conn.QueryRow(t.Context(), `SELECT session_copy_turn_batch(3)`).Scan(&n)
		result <- err
	}()
	waitTurnBlocked(t, s, conn.Conn().PgConn().PID())
	if _, err = writer.Exec(t.Context(), `DELETE FROM session_turns WHERE session_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err = writer.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = <-result; err != nil {
		t.Fatal(err)
	}
	turnCutover(t, s)
	turnInvariant(t, s, true)
	var n int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM session_turns`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("purged facts resurrected: %d %v", n, err)
	}
}
func TestTurnMonthlyConcurrentCalibration(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnMigration(t, s, "down")
	at := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	id := turnSeedSession(t, s, user, at)
	turnSeed(t, s, id, 1, at)
	turnExec(t, s, `UPDATE sessions SET turn_count=999 WHERE id=$1`, id)
	turnMigration(t, s, "up")
	calibration, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer calibration.Rollback(context.Background())
	if _, err = calibration.Exec(t.Context(), `SELECT id FROM sessions WHERE id=$1 FOR UPDATE`, id); err != nil {
		t.Fatal(err)
	}
	conn, err := s.pool.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	result := make(chan error, 1)
	go func() {
		_, err := conn.Exec(t.Context(), `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind) VALUES($1,2,1,'hash',2,$2,$2,'complete','snapshot','prompt')`, id, at.AddDate(0, 1, 0))
		result <- err
	}()
	waitTurnBlocked(t, s, conn.Conn().PgConn().PID())
	if _, err = sqlc.New(calibration).CalibrateTurnCounts(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = calibration.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = <-result; err != nil {
		t.Fatal(err)
	}
	var n int
	if err = s.pool.QueryRow(t.Context(), `SELECT turn_count FROM sessions WHERE id=$1`, id).Scan(&n); err != nil || n != 2 {
		t.Fatalf("calibration lost concurrent write: %d %v", n, err)
	}
	turnCutover(t, s)
	turnInvariant(t, s, true)
}
func TestTurnMonthlyConcurrentReports(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnCutover(t, s)
	at := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	id := turnSeedSession(t, s, user, at)
	// Independent report transactions serialize by the existing session row lock.
	results := make(chan error, 8)
	for i := 1; i <= 8; i++ {
		go func(i int) {
			tx, err := s.pool.Begin(t.Context())
			if err != nil {
				results <- err
				return
			}
			defer tx.Rollback(context.Background())
			if _, err = tx.Exec(t.Context(), `SELECT id FROM sessions WHERE id=$1 FOR UPDATE`, id); err == nil {
				_, err = tx.Exec(t.Context(), `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind) VALUES($1,$2::integer,1,'hash',$2::bigint,$3,$3,'complete','snapshot','prompt')`, id, i, at.AddDate(0, i, 0))
			}
			if err == nil {
				err = tx.Commit(t.Context())
			}
			results <- err
		}(i)
	}
	for range 8 {
		if err := <-results; err != nil {
			t.Fatal(fmt.Errorf("concurrent report: %w", err))
		}
	}
	turnInvariant(t, s, true)
}
