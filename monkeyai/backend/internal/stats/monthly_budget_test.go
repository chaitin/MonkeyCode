package stats

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestHourlyMonthlyMoveBudget(t *testing.T) {
	s, _, model := fixture(t)
	const month = "2041-08-01T00:00:00+08:00"
	exec(t, s, "INSERT INTO stats_model_hourly(hour_start,model_id,user_id,calls) SELECT $1,$2,gen_random_uuid(),1 FROM generate_series(1,5001)", month, model)
	exec(t, s, "INSERT INTO stats_model_credit_hourly(hour_start,user_id,credits) SELECT $1,gen_random_uuid(),1 FROM generate_series(1,5000)", month)
	_, err := s.pool.Exec(t.Context(), "SELECT stats_model_ensure_months($1)", month)
	var dbErr *pgconn.PgError
	if !errors.As(err, &dbErr) || dbErr.Code != "54000" {
		t.Fatalf("超过两表合计上限应停止自动搬迁: %v", err)
	}
	check := func(table string, want int) {
		t.Helper()
		var n int
		if err := s.pool.QueryRow(t.Context(), "SELECT count(*) FROM "+table+" WHERE hour_start=$1", month).Scan(&n); err != nil || n != want {
			t.Fatalf("%s: %d, want %d: %v", table, n, want, err)
		}
	}
	check("stats_model_hourly_default", 5001)
	check("stats_model_credit_hourly_default", 5000)
	exec(t, s, "DELETE FROM stats_model_hourly_default WHERE ctid=(SELECT ctid FROM stats_model_hourly_default WHERE hour_start=$1 LIMIT 1)", month)
	exec(t, s, "SELECT stats_model_ensure_months($1)", month)
	check("stats_model_hourly_2041_08", 5000)
	check("stats_model_credit_hourly_2041_08", 5000)
	check("stats_model_hourly_default", 0)
	check("stats_model_credit_hourly_default", 0)
}
