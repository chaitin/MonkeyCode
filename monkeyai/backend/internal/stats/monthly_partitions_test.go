package stats

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestHourlyMonthlyPartitions(t *testing.T) {
	s, user, model := fixture(t)
	rollback, err := os.ReadFile("../../migrations/000059_stats_model_employee.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(t, s, string(rollback))
	account := hourlyAccount(t, s, user)
	migrate := func(direction string) {
		t.Helper()
		data, err := os.ReadFile("../../migrations/000058_stats_model_monthly." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		exec(t, s, string(data))
	}
	scalar := func(q string, args ...any) string {
		t.Helper()
		var got string
		if err := s.pool.QueryRow(t.Context(), q, args...).Scan(&got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	tables := []string{"stats_model_hourly", "stats_model_credit_hourly"}
	checkRoute := func(at time.Time, suffix string) {
		t.Helper()
		for _, table := range tables {
			if got := scalar("SELECT tableoid::regclass::text FROM "+table+" WHERE hour_start=$1", at); got != table+suffix {
				t.Fatalf("%v：实际 %s，预期 %s%s", at, got, table, suffix)
			}
		}
	}
	record := func(at time.Time, entry string, delta int) {
		t.Helper()
		call(t, s, user, model, "succeeded", at.Add(-time.Minute), at, 12, 4, 5, 25)
		exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,$3,'model','测试',$4,0,$5)`, account, user, entry, delta, at)
	}
	// Seed genuine pre-upgrade projections across Shanghai New Year, including a negative net credit bucket.
	migrate("down")
	jan := time.Date(2020, 12, 31, 16, 0, 0, 0, time.UTC)
	dec := jan.Add(-time.Hour)
	record(dec, "charge", -9)
	record(jan, "refund", 2)
	for range 2 {
		migrate("up")
		checkRoute(dec, "_2020_12")
		checkRoute(jan, "_2021_01")
		assertHourlyFacts(t, s)
		later := jan.AddDate(0, 3, 0)
		if scalar("SELECT count(*)::text FROM stats_model_hourly WHERE hour_start=$1", later) == "0" {
			record(later, "charge", -3)
			checkRoute(later, "_default")
		}
		exec(t, s, "SELECT stats_model_ensure_months($1)", jan)
		checkRoute(later, "_2021_04")
		if scalar("SELECT to_regclass('stats_model_hourly_2021_03')::text") != "stats_model_hourly_2021_03" {
			t.Fatal("未预建未来月份")
		}
		for _, table := range tables {
			plan := scalar("EXPLAIN (FORMAT JSON, COSTS OFF) SELECT * FROM " + table + " WHERE hour_start >= '2020-12-31T16:00Z' AND hour_start < '2021-01-31T16:00Z'")
			if !strings.Contains(plan, table+"_2021_01") || strings.Contains(plan, table+"_2020_12") || strings.Contains(plan, table+"_default") {
				t.Fatal("未按月裁剪", plan)
			}
		}
		record(jan, "charge", -5)                   // Existing bucket UPSERT after the table swap.
		record(jan.AddDate(-10, 0, 0), "refund", 1) // A fallback row must also survive down.
		assertHourlyFacts(t, s)
		migrate("down")
		checkRoute(jan, "")
		checkRoute(jan.AddDate(-10, 0, 0), "")
		assertHourlyFacts(t, s)
	}
}
