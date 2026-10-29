package billing

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/jackc/pgx/v5"
)

type entryUserPlan struct {
	sqlc.DBTX
	statement string
	args      []any
}

func (q *entryUserPlan) Query(ctx context.Context, statement string, args ...any) (pgx.Rows, error) {
	q.statement, q.args = statement, args
	return q.DBTX.Query(ctx, statement, args...)
}

func TestSelectedEntryUserUsesExistingIndex(t *testing.T) {
	s, user, _ := fixture(t)
	ledgerMigration(t, s, "down")
	entrySearchAccount(t, s, user)
	ledgerExec(t, s, `WITH added AS (
 INSERT INTO users(id,name,email) SELECT md5('billing-index-user-'||n)::uuid,'索引成员 '||n,'index-'||n||'@index.test' FROM generate_series(1,999) n RETURNING id)
 INSERT INTO credit_accounts(user_id,period_start_at,period_end_at,last_refreshed_at)
 SELECT id,'2026-09-01','2026-10-01','2026-09-01' FROM added`)
	ledgerExec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,user_name,user_email,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
 SELECT a.id,a.user_id,'历史姓名','historical@example.test','charge','model','索引验证',-1,0,'2026-09-01'::timestamptz+n*interval '1 second'
 FROM generate_series(1,100000) n JOIN credit_accounts a ON a.user_id=CASE WHEN n%1000=0 THEN $1::uuid ELSE md5('billing-index-user-'||(n%1000))::uuid END`, user)
	check := func(t *testing.T) {
		ledgerExec(t, s, `ANALYZE credit_ledger_entries; ANALYZE users;`)
		capture := &entryUserPlan{DBTX: s.pool}
		q := sqlc.New(capture)
		from, until := defaultEntryRange(s.now())
		params := sqlc.ListEntriesByUserParams{UserID: user, FromTime: &from, UntilTime: &until, Limit: 51}
		// Exercise prepared statements past PostgreSQL's initial custom-plan window.
		for range 8 {
			rows, err := q.ListEntriesByUser(t.Context(), params)
			if err != nil || len(rows) != 51 {
				t.Fatalf("page: %d %v", len(rows), err)
			}
		}
		var plan []byte
		if err := s.pool.QueryRow(t.Context(), `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) `+capture.statement, capture.args...).Scan(&plan); err != nil {
			t.Fatal(err)
		}
		var parsed any
		if err := json.Unmarshal(plan, &parsed); err != nil {
			t.Fatal(err)
		}
		var visited float64
		indexed := false
		var walk func(any)
		walk = func(v any) {
			switch node := v.(type) {
			case map[string]any:
				if relation, ok := node["Relation Name"].(string); ok && strings.HasPrefix(relation, "credit_ledger_entries") {
					rows, _ := node["Actual Rows"].(float64)
					loops, _ := node["Actual Loops"].(float64)
					removed, _ := node["Rows Removed by Filter"].(float64)
					visited += (rows + removed) * loops
					if cond, ok := node["Index Cond"].(string); ok && strings.Contains(cond, "user_id") {
						indexed = true
					}
				}
				for _, child := range node {
					walk(child)
				}
			case []any:
				for _, child := range node {
					walk(child)
				}
			}
		}
		walk(parsed)
		t.Logf("100000 ledger rows, 1000 users: 51 returned, %.0f facts visited; user index=%v", visited, indexed)
		if !indexed || visited > 200 {
			t.Fatalf("selected user did not use bounded existing indexes: %.0f facts\n%s", visited, plan)
		}
	}
	t.Run("ordinary", check)
	ledgerMigration(t, s, "up")
	for range 20 {
		n, err := sqlc.New(s.pool).CopyLedgerBatch(t.Context(), 10000)
		if err != nil {
			t.Fatal(err)
		}
		if n <= 0 {
			break
		}
	}
	ledgerCutover(t, s)
	t.Run("weekly", check)
}
