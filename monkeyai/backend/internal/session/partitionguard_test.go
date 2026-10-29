package session

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestTurnMonthlyValidationAndBusyCutover(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnMigration(t, s, "down")
	at := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	id := turnSeedSession(t, s, user, at)
	turnSeed(t, s, id, 1, at)
	turnMigration(t, s, "up")
	// Even an ignored historical duplicate must not create its unvisited key.
	turnExec(t, s, `INSERT INTO session_turns SELECT (jsonb_populate_record(NULL::session_turns,to_jsonb(t)||jsonb_build_object('started_at',$2::timestamptz,'ended_at',$2::timestamptz))).* FROM session_turns t WHERE session_id=$1 ON CONFLICT(session_id,turn_index) DO NOTHING`, id, at.AddDate(0, 1, 0))
	var n int
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM session_turns_keys WHERE session_id=$1`, id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("ignored insert leaked a key: %d %v", n, err)
	}
	turnExec(t, s, `INSERT INTO session_turns_partitioned SELECT * FROM session_turns WHERE session_id=$1`, id)
	turnExec(t, s, `UPDATE session_turns_partitioned SET input_text='corrupted shadow' WHERE session_id=$1`, id)
	if _, err := sqlc.New(s.pool).CopyTurnBatch(t.Context()); err == nil {
		t.Fatal("corrupt batch accepted")
	}
	var cursor *string
	if err := s.pool.QueryRow(t.Context(), `SELECT cursor_session::text FROM session_turns_partition_state`).Scan(&cursor); err != nil || cursor != nil {
		t.Fatalf("failed batch advanced cursor: %v %v", cursor, err)
	}
	turnExec(t, s, `UPDATE session_turns SET input_text='repaired through authoritative source' WHERE session_id=$1`, id)
	q := sqlc.New(s.pool)
	for range 3 {
		if _, err := q.CalibrateTurnCounts(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	for range 3 {
		if _, err := q.CopyTurnBatch(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	reader, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Rollback(context.Background())
	if _, err = reader.Exec(t.Context(), `SELECT * FROM session_turns WHERE session_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	_, err = q.CutoverTurns(t.Context())
	var pgerr *pgconn.PgError
	if !errors.As(err, &pgerr) || pgerr.Code != "55P03" {
		t.Fatalf("busy cutover did not fail atomically: %v", err)
	}
	var phase string
	if err = s.pool.QueryRow(t.Context(), `SELECT phase FROM session_turns_partition_state`).Scan(&phase); err != nil || phase != "backfill" {
		t.Fatalf("busy cutover changed state: %s %v", phase, err)
	}
	if err = reader.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	turnCutover(t, s)
	turnInvariant(t, s, true)
}
func TestTurnMonthlyDefaultMoveLimit(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnCutover(t, s)
	at := time.Date(2050, 1, 1, 0, 0, 0, 0, time.UTC)
	id := turnSeedSession(t, s, user, at)
	for i := 1; i <= 3; i++ {
		turnSeed(t, s, id, i, at.Add(time.Duration(i)*time.Second))
	}
	_, err := s.pool.Exec(t.Context(), `SELECT session_create_turn_month($1,2)`, at)
	var pgerr *pgconn.PgError
	if !errors.As(err, &pgerr) || pgerr.Code != "55000" {
		t.Fatalf("default move exceeded limit: %v", err)
	}
	var exists bool
	if err = s.pool.QueryRow(t.Context(), `SELECT to_regclass('session_turns_2050_01') IS NOT NULL`).Scan(&exists); err != nil || exists {
		t.Fatal("failed move left a partial table", err)
	}
	turnInvariant(t, s, true)
	turnExec(t, s, `SELECT session_create_turn_month($1,0)`, at)
	turnInvariant(t, s, true)
}
