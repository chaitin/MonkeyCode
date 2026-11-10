package stats

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestModelMessageDistributionEmpty(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	call(t, s, user, model, "succeeded", now.Add(-time.Minute), now.Add(-time.Second), 100, 0, 20, 1000)
	out := request(t, s, "/statistics/models/overview", 200)
	number(t, out["last_24h"].(map[string]any), "model_calls", 1)
	distribution := out["message_distribution"].(map[string]any)
	number(t, distribution, "total_messages", 0)
	if len(distribution["models"].([]any)) != 0 {
		t.Fatal("model calls must not become reported messages", distribution)
	}
}

func TestModelMessageDistributionScopeAndBoundaries(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	from := now.Add(-24 * time.Hour)
	other, fallback := "10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"
	exec(t, s, `UPDATE models SET display_name='同名模型' WHERE id=$1`, model)
	for _, sample := range []struct{ id, name, upstream string }{{other, "同名模型", "other"}, {fallback, "  ", "fallback-model"}} {
		exec(t, s, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id)
			VALUES($1,'system',$2,$3,'openai_chat_completions','https://private-model.test','private-model-secret','{}',$4)`, sample.id, sample.name, sample.upstream, user)
	}
	exec(t, s, `UPDATE models SET deleted_at=$2,enabled=false WHERE id=$1`, other, now)
	session := resource.ID()
	conversationSession(t, s, user, session, "session-private-title", now.Add(-100*24*time.Hour))
	for index, sample := range []struct {
		at      time.Time
		model   any
		outcome string
	}{
		{from.Add(-time.Microsecond), model, "complete"},
		{from, model, "error"},
		{from.Add(time.Microsecond), other, "interrupted"},
		{now.Add(-2 * time.Minute), nil, "unknown"},
		{now.Add(-time.Minute), model, "max_turns"},
		{now.Add(-30 * time.Second), nil, "output_limit"},
		{now.Add(-10 * time.Second), fallback, "complete"},
		{now, model, "complete"},
		{now.Add(time.Second), other, "complete"},
	} {
		conversationTurn(t, s, session, index+1, sample.at, sample.outcome, "message-private-input", nil, nil)
		exec(t, s, `UPDATE session_turns SET model_id=$3 WHERE session_id=$1 AND turn_index=$2`, session, index+1, sample.model)
	}
	for _, mode := range []string{"deleted", "purged", "placeholder", "unreported", "child", "future", "at_now"} {
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
			exec(t, s, `UPDATE sessions SET parent_session_id=$2 WHERE id=$1`, id, session)
		case "future", "at_now":
			at := now
			if mode == "future" {
				at = now.Add(time.Hour)
			}
			exec(t, s, `UPDATE sessions SET started_at=$2,last_active_at=$2 WHERE id=$1`, id, at)
		}
	}
	call(t, s, user, model, "failed", now.Add(-time.Minute), now.Add(-time.Second), 10, 0, 1, 1)
	out := request(t, s, "/statistics/models/overview", 200)
	distribution := out["message_distribution"].(map[string]any)
	number(t, distribution, "total_messages", 6)
	number(t, out["last_24h"].(map[string]any), "model_calls", 1)
	models := distribution["models"].([]any)
	if len(models) != 4 {
		t.Fatal(models)
	}
	for index, expected := range []struct {
		id       any
		name     any
		messages float64
	}{
		{model, "同名模型", 2}, {nil, nil, 2}, {other, "同名模型", 1}, {fallback, "fallback-model", 1},
	} {
		row := models[index].(map[string]any)
		if row["id"] != expected.id || row["name"] != expected.name {
			t.Fatal(row, expected)
		}
		number(t, row, "messages", expected.messages)
	}
	for key, expected := range map[string]time.Time{"from": from, "until": now} {
		at, err := time.Parse(time.RFC3339Nano, distribution[key].(string))
		if err != nil || !at.Equal(expected) {
			t.Fatal(distribution)
		}
	}
	if distribution["until"] != out["generated_at"] {
		t.Fatal(out)
	}
	sessionOverview := request(t, s, sessionOverviewPath, 200)["last_24h"].(map[string]any)
	if !reflect.DeepEqual(models, sessionOverview["models"]) || distribution["total_messages"] != sessionOverview["messages"] {
		t.Fatal("model and session pages disagree on message usage", distribution, sessionOverview)
	}
	data, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private-model-secret", "private-model.test", "message-private-input", "session-private-title", `"api_key"`, `"user_id"`, `"input_text"`} {
		if strings.Contains(string(data), private) {
			t.Fatalf("private data in model overview: %s", private)
		}
	}
	exec(t, s, `UPDATE users SET status='disabled',disabled_at=$2,deleted_at=$2 WHERE id=$1`, user, now)
	retained := request(t, s, "/statistics/models/overview", 200)["message_distribution"].(map[string]any)
	if !reflect.DeepEqual(retained, distribution) {
		t.Fatal("history must survive disabled/deleted owners", retained)
	}
}
