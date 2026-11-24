package stats

import (
	"os"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

// Exercise the 58 -> 59 cutover with overlapping hour/model keys, old facts,
// corrections and an unbacked old aggregate (never infer its owner).
func TestEmployeeHourlyBackfillAndCorrections(t *testing.T) {
	s, first, model := fixture(t)
	migrate := func(direction string) {
		t.Helper()
		b, err := os.ReadFile("../../migrations/000059_stats_model_employee." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		exec(t, s, string(b))
	}
	check := func(want int, q string, args ...any) {
		t.Helper()
		var got int
		if err := s.pool.QueryRow(t.Context(), q, args...).Scan(&got); err != nil || got != want {
			t.Fatalf("%s: got=%d want=%d err=%v", q, got, want, err)
		}
	}
	var start time.Time
	if err := s.pool.QueryRow(t.Context(), "SELECT from_hour FROM stats_model_user_backfill").Scan(&start); err != nil {
		t.Fatal(err)
	}
	migrate("down")
	old := start.Add(-time.Hour)
	other := resource.ID()
	exec(t, s, "INSERT INTO users(id,name,email) VALUES($1,'other','hour@test.invalid')", other)
	for i, uid := range []string{first, other} {
		account := hourlyAccount(t, s, uid)
		call(t, s, uid, model, "succeeded", start.Add(-time.Minute), start, int64(2+i), 0, 1, nil)
		exec(t, s, "INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,'charge','model','test',-4,0,$3),($1,$2,'refund','model','test',1,0,$3)", account, uid, start)
	}
	call(t, s, first, model, "succeeded", old.Add(-time.Minute), old, 8, 0, 1, nil)
	exec(t, s, "UPDATE stats_model_hourly SET calls=calls+4 WHERE hour_start=$1", old)
	// Drift inside the backfill window is replaced by facts, not added to them.
	exec(t, s, "UPDATE stats_model_hourly SET calls=calls+6 WHERE hour_start=$1", start)
	migrate("up")
	check(2, "SELECT count(*) FROM stats_model_hourly WHERE hour_start=$1 AND user_id IS NOT NULL", start)
	check(5, "SELECT calls FROM stats_model_hourly WHERE hour_start=$1 AND user_id IS NULL", old)
	check(2, "SELECT SUM(calls) FROM stats_model_hourly WHERE hour_start=$1", start)
	check(3, "SELECT credits FROM stats_model_credit_hourly WHERE hour_start=$1 AND user_id=$2", start, other)
	exec(t, s, "UPDATE model_calls SET user_id=$1 WHERE user_id=$2 AND completed_at=$3", other, first, start)
	check(2, "SELECT calls FROM stats_model_hourly WHERE hour_start=$1 AND user_id=$2", start, other)
	check(0, "SELECT calls FROM stats_model_hourly WHERE hour_start=$1 AND user_id=$2", start, first)
	exec(t, s, "UPDATE model_calls SET completed_at=$1 WHERE completed_at=$2", start, old)
	check(4, "SELECT calls FROM stats_model_hourly WHERE hour_start=$1 AND user_id IS NULL", old)
	check(8, "SELECT input_tokens FROM stats_model_hourly WHERE hour_start=$1 AND user_id=$2", start, first)
	exec(t, s, "DELETE FROM model_calls WHERE user_id=$1 AND completed_at=$2", other, start)
	check(0, "SELECT calls FROM stats_model_hourly WHERE hour_start=$1 AND user_id=$2", start, other)
	migrate("down")
	check(1, "SELECT calls FROM stats_model_hourly WHERE hour_start=$1", start)
	check(4, "SELECT calls FROM stats_model_hourly WHERE hour_start=$1", old)
	check(6, "SELECT credits FROM stats_model_credit_hourly WHERE hour_start=$1", start)
}
