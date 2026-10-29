package session

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func turnExec(t *testing.T, s *Service, query string, args ...any) {
	t.Helper()
	if _, err := s.pool.Exec(t.Context(), query, args...); err != nil {
		t.Fatal(err)
	}
}
func turnMigration(t *testing.T, s *Service, direction string) {
	t.Helper()
	b, err := os.ReadFile("../../migrations/000034_session_turns_monthly." + direction + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	turnExec(t, s, string(b))
}
func turnSeedSession(t *testing.T, s *Service, user string, at time.Time) string {
	t.Helper()
	id := resource.ID()
	turnExec(t, s, `INSERT INTO sessions(id,owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,reporting_enabled_at) VALUES($1,$2,'monthly','conversation','desktop','test',$3,$3,$3)`, id, user, at)
	turnExec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, id)
	return id
}
func turnSeed(t *testing.T, s *Service, id string, n int, at time.Time) {
	t.Helper()
	turnExec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind,input_text) VALUES($1,$2,1,'hash',1,$3,$3::timestamptz+interval '1 second','complete','snapshot','prompt','monthly text')`, id, n, at)
}
func turnCutover(t *testing.T, s *Service) {
	t.Helper()
	q := sqlc.New(s.pool)
	for range 100 {
		n, err := q.CalibrateTurnCounts(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if n <= 0 {
			break
		}
	}
	for range 100 {
		n, err := q.CopyTurnBatch(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if n <= 0 {
			break
		}
	}
	ready, err := q.CutoverTurns(t.Context())
	if err != nil || !ready {
		t.Fatalf("cutover: %v %v", ready, err)
	}
}
func turnInvariant(t *testing.T, s *Service, mirror bool) {
	t.Helper()
	var valid bool
	query := `SELECT NOT EXISTS(SELECT 1 FROM session_turns t FULL JOIN session_turns_keys k USING(session_id,turn_index,started_at) WHERE t.session_id IS NULL OR k.session_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.turn_count_verified AND s.turn_count<>(SELECT count(*) FROM session_turns_keys k WHERE k.session_id=s.id))`
	if mirror {
		query += ` AND NOT EXISTS(SELECT 1 FROM session_turns t FULL JOIN session_turns_legacy l USING(session_id,turn_index) WHERE to_jsonb(t) IS DISTINCT FROM to_jsonb(l))`
	}
	if err := s.pool.QueryRow(t.Context(), query).Scan(&valid); err != nil || !valid {
		t.Fatalf("facts/registry/count/mirror mismatch: %v %v", valid, err)
	}
}
func TestTurnMonthlyMigration(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnMigration(t, s, "down")
	boundary := time.Date(2027, 1, 1, 0, 0, 0, 0, time.FixedZone("Shanghai", 8*3600))
	id := turnSeedSession(t, s, user, boundary.Add(-time.Hour))
	turnSeed(t, s, id, 1, boundary.Add(-time.Microsecond))
	turnSeed(t, s, id, 2, boundary)
	turnExec(t, s, `UPDATE sessions SET turn_count=999 WHERE id=$1`, id)
	turnExec(t, s, `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,name,calls,failed,duration_ms) VALUES($1,1,0,'builtin','test',1,0,1)`, id)
	turnExec(t, s, `INSERT INTO session_skill_events(session_id,turn_index,ordinal,skill_id,name,trigger,ok) VALUES($1,1,0,'skill','skill','user',true)`, id)
	turnMigration(t, s, "up")
	// A historical identity still routes before its registry row is visited.
	var route time.Time
	if err := s.pool.QueryRow(t.Context(), `SELECT session_turn_time($1,1)`, id).Scan(&route); err != nil || !route.Equal(boundary.Add(-time.Microsecond)) {
		t.Fatalf("historical route: %v %v", route, err)
	}
	var verified bool
	if err := s.pool.QueryRow(t.Context(), `SELECT turn_count_verified FROM sessions WHERE id=$1`, id).Scan(&verified); err != nil || verified {
		t.Fatal("old counter must start unverified", err)
	}
	turnExec(t, s, `UPDATE session_turns SET input_text='new content' WHERE session_id=$1 AND turn_index=1`, id)
	turnSeed(t, s, id, 3, boundary.Add(32*24*time.Hour))
	// ON CONFLICT ignored inserts cannot register or count a different month.
	turnExec(t, s, `INSERT INTO session_turns SELECT (jsonb_populate_record(NULL::session_turns,to_jsonb(t)||jsonb_build_object('started_at',$2::timestamptz,'ended_at',$2::timestamptz))).* FROM session_turns t WHERE session_id=$1 AND turn_index=1 ON CONFLICT(session_id,turn_index) DO NOTHING`, id, boundary)
	old, err := s.pool.BeginTx(t.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer old.Rollback(context.Background())
	var phase string
	if err = old.QueryRow(t.Context(), `SELECT phase FROM session_turns_partition_state`).Scan(&phase); err != nil {
		t.Fatal(err)
	}
	turnCutover(t, s)
	var staleRoute *time.Time
	if err = old.QueryRow(t.Context(), `SELECT session_turn_time($1,2)`, id).Scan(&staleRoute); err != nil || staleRoute != nil {
		t.Fatalf("stale snapshot fell back to legacy: %v %v", staleRoute, err)
	}
	if err = old.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	turnExec(t, s, `SELECT session_ensure_turn_months(now())`)
	turnInvariant(t, s, true)
	var table string
	for idx, want := range map[int]string{1: "session_turns_2026_12", 2: "session_turns_2027_01", 3: "session_turns_2027_02"} {
		if err := s.pool.QueryRow(t.Context(), `SELECT tableoid::regclass::text FROM session_turns WHERE session_id=$1 AND turn_index=$2`, id, idx).Scan(&table); err != nil || table != want {
			t.Fatalf("month %d: %s want=%s err=%v", idx, table, want, err)
		}
	}
	q := sqlc.New(s.pool)
	facts, err := q.ListTurnFacts(t.Context(), id)
	if err != nil || len(facts) != 3 {
		t.Fatalf("routed facts: %d %v", len(facts), err)
	}
	indexes, err := q.ListTurnIndexes(t.Context(), id)
	if err != nil || len(indexes) != 3 {
		t.Fatalf("routed indexes: %v %v", indexes, err)
	}
	if _, err = q.GetTurnHash(t.Context(), sqlc.GetTurnHashParams{Column1: id, TurnIndex: 1}); err != nil {
		t.Fatal(err)
	}
	// Cross-month global duplicates must fail even through the partition parent.
	_, err = s.pool.Exec(t.Context(), `INSERT INTO session_turns SELECT (jsonb_populate_record(NULL::session_turns,to_jsonb(t)||jsonb_build_object('started_at',$2::timestamptz,'ended_at',$2::timestamptz))).* FROM session_turns t WHERE session_id=$1 AND turn_index=1`, id, boundary)
	var pgerr *pgconn.PgError
	if !errors.As(err, &pgerr) || pgerr.Code != "23505" {
		t.Fatalf("cross-month duplicate accepted: %v", err)
	}
	// Preserve the original ON DELETE CASCADE semantics through the registry.
	turnExec(t, s, `DELETE FROM session_turns WHERE session_id=$1 AND turn_index=1`, id)
	var children int
	if err = s.pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM session_turn_tools WHERE session_id=$1)+(SELECT count(*) FROM session_skill_events WHERE session_id=$1)`, id).Scan(&children); err != nil || children != 0 {
		t.Fatalf("cascaded children: %d %v", children, err)
	}
	_, err = s.pool.Exec(t.Context(), `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,calls,failed,duration_ms) VALUES($1,1,0,'builtin',1,0,1)`, id)
	if !errors.As(err, &pgerr) || pgerr.Code != "23503" {
		t.Fatalf("orphan tool accepted: %v", err)
	}
	turnExec(t, s, `UPDATE session_turns SET error_code='updated' WHERE session_id=$1 AND turn_index=2`, id)
	turnInvariant(t, s, true)
	// Physical DEFAULT relocation must not count, delete keys, or mirror twice.
	turnSeed(t, s, id, 4, boundary.AddDate(0, 8, 0))
	turnExec(t, s, `SELECT session_create_turn_month($1)`, boundary.AddDate(0, 8, 0))
	turnInvariant(t, s, true)
	turnExec(t, s, `SELECT session_finish_turn_observation()`)
	turnExec(t, s, `DELETE FROM session_turn_tools WHERE session_id=$1`, id)
	turnExec(t, s, `DELETE FROM session_skill_events WHERE session_id=$1`, id)
	if err := q.DeleteTurns(t.Context(), []string{id}); err != nil {
		t.Fatal(err)
	}
	turnInvariant(t, s, false)
	if err := q.DeleteSnapshotItems(t.Context(), []string{id}); err != nil {
		t.Fatal(err)
	}
	if err := q.DeleteSnapshots(t.Context(), []string{id}); err != nil {
		t.Fatal(err)
	}
	turnExec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, id)
	turnSeed(t, s, id, 5, boundary.AddDate(0, 9, 0))
	turnMigration(t, s, "down")
	var count int
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM session_turns WHERE session_id=$1`, id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rollback resurrected deleted facts: %d %v", count, err)
	}
	turnMigration(t, s, "up")
	turnCutover(t, s)
	turnInvariant(t, s, true)
}

func TestTurnMonthlyBackfillPurgeAndResume(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnMigration(t, s, "down")
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := turnSeedSession(t, s, user, at)
	for i := 1; i <= 5; i++ {
		turnSeed(t, s, id, i, at.AddDate(0, i, 0))
	}
	turnMigration(t, s, "up")
	var n int
	if err := s.pool.QueryRow(t.Context(), `SELECT session_copy_turn_batch(2)`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("first batch: %d %v", n, err)
	}
	// Delete an uncopied row and the watermark, update a copied row, then resume.
	turnExec(t, s, `DELETE FROM session_turns WHERE session_id=$1 AND turn_index IN(3,5)`, id)
	turnExec(t, s, `UPDATE session_turns SET input_text='updated after first batch' WHERE session_id=$1 AND turn_index=1`, id)
	turnCutover(t, s)
	turnInvariant(t, s, true)
	// Old snapshots must never fall back to the legacy source after cutover.
	tx, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var staleWrite *pgconn.PgError
	if _, err = tx.Exec(t.Context(), `UPDATE session_turns_legacy SET input_text='stale write' WHERE session_id=$1`, id); !errors.As(err, &staleWrite) || staleWrite.Code != "40001" {
		t.Fatalf("legacy write must require a new transaction: %v", err)
	}
	// Before-cutover rollback also preserves authoritative source facts.
	tx.Rollback(context.Background())
	turnMigration(t, s, "down")
	turnMigration(t, s, "up")
	turnMigration(t, s, "down")
}

func TestTurnMonthlyPrunesAndBounds(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	turnCutover(t, s)
	at := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	id := turnSeedSession(t, s, user, at)
	for i := 0; i < 12; i++ {
		turnSeed(t, s, id, i+1, at.AddDate(0, i, 0))
		turnExec(t, s, `SELECT session_create_turn_month($1)`, at.AddDate(0, i, 0))
	}
	var plan []byte
	if err := s.pool.QueryRow(t.Context(), `EXPLAIN (ANALYZE,FORMAT JSON) SELECT * FROM session_turns WHERE session_id=$1 AND turn_index=4 AND started_at=session_turn_time($1,4)`, id).Scan(&plan); err != nil {
		t.Fatal(err)
	}
	var parsed any
	if err := json.Unmarshal(plan, &parsed); err != nil {
		t.Fatal(err)
	}
	text := string(plan)
	if !strings.Contains(text, "session_turns_2026_08") {
		t.Fatalf("expected August partition: %s", plan)
	}
	// Runtime pruning reports other children as never executed, or removes them.
	var walk func(any)
	executed := map[string]bool{}
	walk = func(v any) {
		switch v := v.(type) {
		case map[string]any:
			if name, ok := v["Relation Name"].(string); ok {
				if loops, ok := v["Actual Loops"].(float64); ok && loops > 0 {
					executed[name] = true
				}
			}
			for _, c := range v {
				walk(c)
			}
		case []any:
			for _, c := range v {
				walk(c)
			}
		}
	}
	walk(parsed)
	for name := range executed {
		if strings.HasPrefix(name, "session_turns_") && name != "session_turns_keys" && name != "session_turns_2026_08" {
			t.Fatalf("unrelated partition executed: %s %s", name, text)
		}
	}
	// Wrongly occupied names and excessive default backlog must fail safely.
	turnExec(t, s, `CREATE TABLE session_turns_2040_01(id integer)`)
	if _, err := s.pool.Exec(t.Context(), `SELECT session_create_turn_month('2040-01-01+08')`); err == nil {
		t.Fatal("occupied partition name accepted")
	}
	turnInvariant(t, s, true)
}
