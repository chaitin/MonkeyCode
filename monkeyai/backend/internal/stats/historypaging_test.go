package stats

import (
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestHistoryMonthlyParity(t *testing.T) {
	s, user, _ := fixture(t)
	at := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	ids := []string{"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"}
	for _, id := range ids {
		conversationSession(t, s, user, id, "month task", at)
		for i := 1; i <= 4; i++ {
			conversationTurn(t, s, id, i, at.AddDate(0, i, 0), "complete", "text", 10, 5)
		}
	}
	paths := []string{
		"/statistics/history?page_size=1", "/statistics/history?page_size=1&page=2", "/statistics/history?page_size=1&page=3",
		"/statistics/conversations?page_size=2", "/statistics/conversations?page_size=2&page=4", "/statistics/conversations?page_size=2&page=5",
		"/statistics/conversations?task_id=" + ids[0] + "&page_size=2", "/statistics/conversations?task_id=" + ids[0] + "&page_size=2&page=2",
		"/statistics/conversations?task_id=" + ids[0] + "&from=2026-08-01T00:00:00Z&until=2026-09-01T00:00:00Z",
		"/statistics/conversations?task_id=00000000-0000-4000-8000-000000000099&page=3",
		"/statistics/conversations?task_id=" + ids[0] + "&content=missing",
		"/statistics/conversations?task_id=" + ids[0] + "&user=missing",
		"/statistics/conversations?from=2026-08-01T00:00:00Z&until=2026-09-01T00:00:00Z",
	}
	before := make([]map[string]any, len(paths))
	for i, p := range paths {
		before[i] = request(t, s, p, 200)
	}
	exec(t, s, `SELECT session_ensure_turn_months(now())`)
	var ready bool
	if err := s.pool.QueryRow(t.Context(), `SELECT session_cutover_turns()`).Scan(&ready); err != nil || !ready {
		t.Fatalf("cutover: %v %v", ready, err)
	}
	for i, p := range paths {
		after := request(t, s, p, 200)
		if !reflect.DeepEqual(before[i], map[string]any(after)) {
			t.Fatalf("monthly changed API %s: before=%v after=%v", p, before[i], after)
		}
	}
}

func TestHistoryCounterCalibration(t *testing.T) {
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
	conversationSession(t, s, user, id, "uncalibrated", at)
	conversationTurn(t, s, id, 1, at, "complete", "text", 10, 5)
	exec(t, s, `UPDATE sessions SET turn_count=999 WHERE id=$1`, id)
	migration("up")
	conversations := request(t, s, "/statistics/conversations?task_id="+id, 200)
	assertHistoryPage(t, conversations, false, 1)
	out := request(t, s, "/statistics/history", 200)
	assertHistoryPage(t, out, false, 1)
	if out["items"].([]any)[0].(map[string]any)["turn_count"] != nil {
		t.Fatal("unverified counter should be null")
	}
	exec(t, s, `SELECT session_calibrate_turn_counts(100)`)
	out = request(t, s, "/statistics/history", 200)
	number(t, out["items"].([]any)[0].(map[string]any), "turn_count", 1)
	conversationTurn(t, s, id, 2, at.Add(time.Second), "complete", "new", 1, 1)
	out = request(t, s, "/statistics/history", 200)
	number(t, out["items"].([]any)[0].(map[string]any), "turn_count", 2)
	exec(t, s, `DELETE FROM session_turns WHERE session_id=$1`, id)
	out = request(t, s, "/statistics/history", 200)
	number(t, out["items"].([]any)[0].(map[string]any), "turn_count", 0)
}

func TestHistorySQLHasNoCounts(t *testing.T) {
	b, err := os.ReadFile("query.sql")
	if err != nil {
		t.Fatal(err)
	}
	history := strings.Split(string(b), "-- name: ReportingRealtime")[0]
	if strings.Contains(strings.ToLower(history), "count(") {
		t.Fatal("history requests must not execute COUNT")
	}
	for _, name := range []string{"CountHistory", "CountConversations"} {
		if strings.Contains(string(b), name) {
			t.Fatal("obsolete count query:", name)
		}
	}
}
