package stats

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
)

func TestTaskHistoryWaitsForCutoverSnapshot(t *testing.T) {
	s, user, _ := fixture(t)
	migration := func(direction string) {
		t.Helper()
		b, err := os.ReadFile("../../migrations/000034_session_turns_monthly." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		exec(t, s, string(b))
	}
	migration("down")
	id := "00000000-0000-4000-8000-000000000001"
	at := s.now()
	conversationSession(t, s, user, id, "snapshot task", at)
	for i := 1; i <= 5; i++ {
		conversationTurn(t, s, id, i, at.Add(time.Duration(i)*time.Second), "complete", "text", 1, 1)
	}
	migration("up")
	writer, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(context.Background())
	if _, err = writer.Exec(t.Context(), `LOCK TABLE session_turns,session_turns_partitioned IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	type result struct {
		n   int
		err error
	}
	done := make(chan result, 1)
	go func() {
		rows, err := s.taskConversationRows(t.Context(), sqlc.ListConversationsParams{TaskID: id, Limit: 51})
		done <- result{len(rows), err}
	}()
	blocked := false
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		if err = s.pool.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, writer.Conn().PgConn().PID()).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("history reader did not wait for the root lock")
	}
	for _, stmt := range []string{`SELECT session_calibrate_turn_counts(100)`, `SELECT session_calibrate_turn_counts(100)`, `SELECT session_copy_turn_batch(1000)`, `SELECT session_copy_turn_batch(1000)`} {
		if _, err = writer.Exec(t.Context(), stmt); err != nil {
			t.Fatal(err)
		}
	}
	var ready bool
	if err = writer.QueryRow(t.Context(), `SELECT session_cutover_turns()`).Scan(&ready); err != nil || !ready {
		t.Fatalf("cutover: %v %v", ready, err)
	}
	if err = writer.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	out := <-done
	if out.err != nil || out.n != 5 {
		t.Fatalf("reader lost turns while cutover committed: %d %v", out.n, out.err)
	}
}
