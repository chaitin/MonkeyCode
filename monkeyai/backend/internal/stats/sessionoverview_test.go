package stats

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const sessionOverviewPath = "/statistics/session-reporting/sessions/overview"

func TestSessionOverviewRejectsFilters(t *testing.T) {
	for _, query := range []string{"?range=7d", "?model_id=x", "?from=", "?%zz"} {
		t.Run(query, func(t *testing.T) {
			w := httptest.NewRecorder()
			(&Service{}).sessionOverview(w, httptest.NewRequest("GET", sessionOverviewPath+query, nil))
			if w.Code != http.StatusBadRequest || w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatalf("invalid query: %d %v %s", w.Code, w.Header(), w.Body)
			}
		})
	}
}

func TestSessionOverviewEmpty(t *testing.T) {
	s, _, _ := fixture(t)
	out := request(t, s, sessionOverviewPath, 200)
	for _, key := range []string{"total_sessions", "new_sessions_24h", "active_sessions_24h", "total_messages"} {
		number(t, out, key, 0)
	}
	recent := out["last_24h"].(map[string]any)
	number(t, recent, "messages", 0)
	if len(recent["models"].([]any)) != 0 {
		t.Fatal(recent)
	}
	for _, value := range recent["outcomes"].(map[string]any) {
		if value != float64(0) {
			t.Fatal(recent)
		}
	}
	for _, key := range []string{"duration_seconds", "messages_per_session"} {
		for _, value := range recent[key].(map[string]any) {
			if value != nil {
				t.Fatalf("empty distribution must be null: %v", recent)
			}
		}
	}
	days := out["days"].([]any)
	if len(days) != 90 {
		t.Fatal(len(days))
	}
	for _, raw := range days {
		for _, key := range []string{"new_sessions", "active_sessions", "messages"} {
			number(t, raw.(map[string]any), key, 0)
		}
	}
}

func TestSessionOverviewDistributionsAndModels(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	otherModel := resource.ID()
	exec(t, s, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id,deleted_at,enabled)
		VALUES($1,'system','历史模型','other-upstream','openai_chat_completions','https://example.com','secret-key','{}',$2,$3,false)`, otherModel, user, now)
	outcomes := []string{"complete", "error", "interrupted", "max_turns", "output_limit", "unknown"}
	count := 0
	for n := 1; n <= 10; n++ {
		id := resource.ID()
		conversationSession(t, s, user, id, "不应返回的会话正文", now.Add(-2*time.Hour))
		for index := 1; index <= n; index++ {
			at := now.Add(-time.Hour).Add(time.Duration(count) * time.Second)
			conversationTurn(t, s, id, index, at, outcomes[count%len(outcomes)], "private-input", nil, nil)
			var modelID any
			switch count % 3 {
			case 0:
				modelID = model
			case 1:
				modelID = otherModel
			}
			count++
			exec(t, s, `UPDATE session_turns SET ended_at=started_at + $3 * interval '1 second',model_id=$4 WHERE session_id=$1 AND turn_index=$2`, id, index, count, modelID)
		}
	}
	// An upstream call alone is not a reported message.
	call(t, s, user, model, "succeeded", now.Add(-time.Minute), now.Add(-time.Second), 1000, 0, 10, 1)
	out := request(t, s, sessionOverviewPath, 200)
	for key, want := range map[string]float64{"total_sessions": 10, "new_sessions_24h": 10, "active_sessions_24h": 10, "total_messages": 55} {
		number(t, out, key, want)
	}
	recent := out["last_24h"].(map[string]any)
	number(t, recent, "messages", 55)
	for index, outcome := range outcomes {
		want := float64(9)
		if index == 0 {
			want = 10
		}
		number(t, recent["outcomes"].(map[string]any), outcome, want)
	}
	for key, want := range map[string]float64{"average": 28, "p10": 6, "p90": 50} {
		number(t, recent["duration_seconds"].(map[string]any), key, want)
	}
	for key, want := range map[string]float64{"average": 5.5, "p10": 1, "p90": 9} {
		number(t, recent["messages_per_session"].(map[string]any), key, want)
	}
	models := recent["models"].([]any)
	if len(models) != 3 {
		t.Fatal(models)
	}
	for index, want := range []float64{19, 18, 18} {
		row := models[index].(map[string]any)
		number(t, row, "messages", want)
		if index == 2 {
			if row["id"] != nil || row["name"] != nil {
				t.Fatal(row)
			}
		} else if row["name"] != "历史模型" {
			t.Fatal("same display names must not merge different model IDs", row)
		}
	}
}

func TestSessionOverviewScopeAndBoundaries(t *testing.T) {
	s, user, _ := fixture(t)
	now := time.Date(2026, 11, 3, 16, 5, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	today := time.Date(2026, 11, 4, 0, 0, 0, 0, zone)
	first := today.AddDate(0, 0, -89)
	from := now.Add(-24 * time.Hour)
	old := resource.ID()
	conversationSession(t, s, user, old, "旧会话", first.Add(-24*time.Hour))
	for index, at := range []time.Time{first.Add(-time.Microsecond), first, from.Add(-time.Microsecond), from, today.Add(-time.Microsecond), today, now.Add(-time.Microsecond), now, now.Add(time.Hour)} {
		conversationTurn(t, s, old, index+1, at, "unknown", nil, nil, nil)
	}
	for _, at := range []time.Time{from.Add(-time.Microsecond), from, now.Add(-time.Hour), now} {
		conversationSession(t, s, user, resource.ID(), "无消息会话", at)
	}
	for _, mode := range []string{"deleted", "purged", "placeholder", "unreported", "child", "future"} {
		id := resource.ID()
		conversationSession(t, s, user, id, mode, now.Add(-time.Hour))
		conversationTurn(t, s, id, 1, now.Add(-time.Minute), "complete", "excluded-input", nil, nil)
		switch mode {
		case "deleted":
			exec(t, s, `UPDATE sessions SET deleted_at=$2 WHERE id=$1`, id, now)
		case "purged":
			exec(t, s, `UPDATE sessions SET purged_at=$2 WHERE id=$1`, id, now)
		case "placeholder":
			exec(t, s, `UPDATE sessions SET placeholder=true WHERE id=$1`, id)
		case "unreported":
			exec(t, s, `UPDATE sessions SET reporting_enabled_at=NULL WHERE id=$1`, id)
		case "child":
			exec(t, s, `UPDATE sessions SET parent_session_id=$2 WHERE id=$1`, id, old)
		case "future":
			exec(t, s, `UPDATE sessions SET started_at=$2,last_active_at=$2 WHERE id=$1`, id, now.Add(time.Hour))
		}
	}
	out := request(t, s, sessionOverviewPath, 200)
	for key, want := range map[string]float64{"total_sessions": 4, "new_sessions_24h": 2, "active_sessions_24h": 1, "total_messages": 7} {
		number(t, out, key, want)
	}
	recent := out["last_24h"].(map[string]any)
	number(t, recent, "messages", 4)
	for _, key := range []string{"average", "p10", "p90"} {
		number(t, recent["messages_per_session"].(map[string]any), key, 4)
	}
	for key, want := range map[string]time.Time{"from": from, "until": now} {
		at, err := time.Parse(time.RFC3339Nano, recent[key].(string))
		if err != nil || !at.Equal(want) {
			t.Fatal(recent)
		}
	}
	days := out["days"].([]any)
	for index, raw := range days {
		row := raw.(map[string]any)
		date := first.AddDate(0, 0, index).Format(time.DateOnly)
		if row["date"] != date {
			t.Fatalf("non-continuous Shanghai dates: %v want %s", row, date)
		}
		messages, active, created := float64(0), float64(0), float64(0)
		switch index {
		case 0:
			messages, active = 1, 1
		case 88:
			messages, active, created = 3, 1, 3
		case 89:
			messages, active = 2, 1
		}
		number(t, row, "messages", messages)
		number(t, row, "active_sessions", active)
		number(t, row, "new_sessions", created)
	}
	// History retains sessions owned by disabled or soft-deleted members.
	exec(t, s, `UPDATE users SET status='disabled',disabled_at=$2,deleted_at=$2 WHERE id=$1`, user, now)
	number(t, request(t, s, sessionOverviewPath, 200), "total_messages", 7)
	if out["timezone"] != "Asia/Shanghai" {
		t.Fatal(fmt.Sprint(out))
	}
}
