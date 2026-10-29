package stats

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
)

type historyPlanQuery struct {
	sqlc.DBTX
	statement string
	args      []any
}

func (q *historyPlanQuery) Query(ctx context.Context, statement string, args ...any) (pgx.Rows, error) {
	q.statement, q.args = statement, args
	return q.DBTX.Query(ctx, statement, args...)
}

func TestTaskHistoryPageReadsBoundedFacts(t *testing.T) {
	s, user, _ := fixture(t)
	at := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	id := "00000000-0000-4000-8000-000000000001"
	conversationSession(t, s, user, id, "long task", at)
	exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind,input_text)
 SELECT $1,n,1,'hash',n,$2::timestamptz+n*interval '1 hour',$2::timestamptz+n*interval '1 hour'+interval '1 second','complete','snapshot','prompt',repeat('x',4000) FROM generate_series(1,2000) n`, id, at)
	exec(t, s, `SELECT session_ensure_turn_months(now())`)
	var ready bool
	if err := s.pool.QueryRow(t.Context(), `SELECT session_cutover_turns()`).Scan(&ready); err != nil || !ready {
		t.Fatalf("cutover: %v %v", ready, err)
	}
	exec(t, s, `ANALYZE sessions; ANALYZE users; ANALYZE session_turns; ANALYZE session_turns_keys;`)
	capture := &historyPlanQuery{DBTX: s.pool}
	q := sqlc.New(capture)
	params, err := taskConversationParams(t.Context(), q, sqlc.ListConversationsParams{TaskID: id, Limit: 51})
	if err != nil || params == nil {
		t.Fatalf("task bounds: %v %v", params, err)
	}
	rows, err := q.ListTaskConversations(t.Context(), *params)
	if err != nil || len(rows) != 51 {
		t.Fatalf("page: %d %v", len(rows), err)
	}
	var first map[string]any
	if err := json.Unmarshal(rows[0], &first); err != nil || first["turn_index"] != float64(2000) {
		t.Fatalf("latest turn was excluded by the time bounds: %v %v", first, err)
	}
	var plan []byte
	if err = s.pool.QueryRow(t.Context(), `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) `+capture.statement, capture.args...).Scan(&plan); err != nil {
		t.Fatal(err)
	}
	var parsed any
	if err = json.Unmarshal(plan, &parsed); err != nil {
		t.Fatal(err)
	}
	var visited float64
	var walk func(any)
	walk = func(v any) {
		switch v := v.(type) {
		case map[string]any:
			if relation, ok := v["Relation Name"].(string); ok && strings.HasPrefix(relation, "session_turns_") && relation != "session_turns_keys" {
				rows, _ := v["Actual Rows"].(float64)
				loops, _ := v["Actual Loops"].(float64)
				visited += rows * loops
			}
			for _, child := range v {
				walk(child)
			}
		case []any:
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(parsed)
	t.Logf("task page returned 51 rows; facts visited %.0f", visited)
	if visited > 200 {
		t.Fatalf("task pagination reads whole task: %.0f facts\n%s", visited, plan)
	}
}
