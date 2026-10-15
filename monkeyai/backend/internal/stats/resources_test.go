package stats

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const resourceUsagePath = "/statistics/session-reporting/resources"

func resourceSession(t *testing.T, s *Service, user string, at time.Time, calls, failed int, available bool) string {
	t.Helper()
	id := resource.ID()
	conversationSession(t, s, user, id, "资源使用", s.now().Add(-30*24*time.Hour))
	conversationTurn(t, s, id, 1, at, "complete", "正文", 1, 1)
	for _, item := range []struct{ kind, id string }{{"builtin", "shared-tool"}, {"rule", "rule-only"}, {"skill", "shared-skill"}} {
		exec(t, s, `INSERT INTO session_resource_snapshot_items(session_id,snapshot_id,resource_id,kind,version,enabled,available)
			VALUES($1,'snapshot',$2,$3,'v1',true,$4)`, id, item.id, item.kind, available)
	}
	resourceTurnCalls(t, s, id, 1, calls, failed)
	return id
}

func resourceTurnCalls(t *testing.T, s *Service, id string, turn, calls, failed int) {
	t.Helper()
	exec(t, s, `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,resource_id,resource_version,calls,failed,duration_ms)
		VALUES($1,$2,0,'builtin','shared-tool','v1',$3,$4,10)`, id, turn, calls, failed)
	// Skill tool summaries must not duplicate skill event facts.
	exec(t, s, `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,resource_id,resource_version,calls,failed,duration_ms)
		VALUES($1,$2,1,'skill','shared-skill','v1',99,99,10)`, id, turn)
	exec(t, s, `INSERT INTO session_skill_events(session_id,turn_index,ordinal,skill_id,version,trigger,ok)
		VALUES($1,$2,0,'shared-skill','v1','user',true),($1,$2,1,'shared-skill','v1','model',false)`, id, turn)
}

func TestResourceUsageRejectsLongUser(t *testing.T) {
	request(t, &Service{now: time.Now}, resourceUsagePath+"?user="+url.QueryEscape(strings.Repeat("用", 201)), 400)
}

func TestResourceUsageUsers(t *testing.T) {
	s, user, _ := fixture(t)
	other := resource.ID()
	exec(t, s, `INSERT INTO users(id,name,email) VALUES($1,'Other%_User','other.user@example.com')`, other)
	a := resourceSession(t, s, user, s.now().Add(-2*time.Hour), 5, 1, true)
	conversationTurn(t, s, a, 2, s.now().Add(-time.Hour), "complete", "重复资源快照", 1, 1)
	resourceTurnCalls(t, s, a, 2, 10, 0)
	child := resourceSession(t, s, user, s.now().Add(-30*time.Minute), 2, 0, false)
	exec(t, s, `UPDATE sessions SET parent_session_id=$2 WHERE id=$1`, child, a)
	b := resourceSession(t, s, other, s.now().Add(-10*time.Minute), 4, 2, true)
	for _, mode := range []string{"deleted", "purged", "placeholder", "unreported", "old", "until"} {
		at := s.now().Add(-time.Minute)
		if mode == "old" {
			at = s.now().Add(-25 * time.Hour)
		} else if mode == "until" {
			at = s.now()
		}
		id := resourceSession(t, s, user, at, 1, 0, true)
		switch mode {
		case "deleted":
			exec(t, s, `UPDATE sessions SET deleted_at=$2 WHERE id=$1`, id, s.now())
		case "purged":
			exec(t, s, `UPDATE sessions SET purged_at=$2 WHERE id=$1`, id, s.now())
		case "placeholder":
			exec(t, s, `UPDATE sessions SET placeholder=true WHERE id=$1`, id)
		case "unreported":
			exec(t, s, `UPDATE sessions SET reporting_enabled_at=NULL WHERE id=$1`, id)
		}
	}
	connector, tool := resource.ID(), resource.ID()
	exec(t, s, `INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode) VALUES($1,$2,'connector','https://example.com','none')`, connector, user)
	exec(t, s, `INSERT INTO mcp_tools(id,connector_id,name,config_revision) VALUES($1,$2,'tool',1)`, tool, connector)
	for _, item := range []struct{ session, actor, status string }{{a, other, "succeeded"}, {a, other, "failed"}, {b, user, "succeeded"}} {
		// Ownership follows the session, including calls made by another actor.
		exec(t, s, `INSERT INTO mcp_tool_calls(session_id,user_id,connector_id,tool_id,status,started_at,completed_at)
			VALUES($1,$2,$3,$4,$5,$6,$6)`, item.session, item.actor, connector, tool, item.status, s.now().Add(-time.Minute))
	}
	exec(t, s, `UPDATE session_turns t SET received_at=$2 FROM sessions s WHERE s.id=t.session_id AND s.owner_user_id=$1`, user, s.now().Add(-10*time.Second))
	exec(t, s, `UPDATE session_turns t SET received_at=$2 FROM sessions s WHERE s.id=t.session_id AND s.owner_user_id=$1`, other, s.now().Add(-100*time.Second))
	out := request(t, s, resourceUsagePath, 200)
	items := out["items"].([]any)
	if len(items) != 8 {
		t.Fatalf("每个用户应有工具、规则、技能和连接器四行: %v", out)
	}
	for _, raw := range items {
		item := raw.(map[string]any)
		id := item["user_id"].(string)
		if id == user {
			if item["user_name"] != "统计用户" || item["user_email"] != "stats@example.com" {
				t.Fatalf("用户信息错误: %v", item)
			}
		} else if id != other || item["user_name"] != "Other%_User" || item["user_email"] != "other.user@example.com" {
			t.Fatalf("混入错误的用户: %v", item)
		}
		sessions, enabled, available, calls, failed := 1.0, 1.0, 1.0, 4.0, 2.0
		if id == user {
			sessions, enabled, calls, failed = 2, 2, 17, 1
		}
		switch item["kind"] {
		case "rule":
			sessions, calls, failed = 0, 0, 0
		case "skill":
			calls, failed = 2, 1
			if id == user {
				calls, failed = 6, 3
			}
		case "connector":
			sessions, enabled, available, calls, failed = 1, 0, 0, 1, 0
			if id == user {
				calls, failed = 2, 1
			}
		}
		number(t, item, "enabled_sessions", enabled)
		number(t, item, "available_sessions", available)
		number(t, item, "used_sessions", sessions)
		number(t, item, "calls", calls)
		number(t, item, "failed", failed)
		if calls == 0 {
			if item["failure_rate"] != nil {
				t.Fatal("没有调用时比例必须为空")
			}
		} else {
			number(t, item, "failure_rate", 100*failed/calls)
		}
	}
	for _, tc := range []struct{ query, user string }{
		{"user=" + url.QueryEscape("  用户  "), user},
		{"user=OTHER.USER%40EXAMPLE.COM", other},
		{"user=" + url.QueryEscape("%_"), other},
		{"user=" + strings.ToUpper(other), other},
		{"user_id=" + user, user},
		{"user=" + url.QueryEscape("Other") + "&resource_id=shared-skill&resource_version=v1", other},
		{"user=" + url.QueryEscape("统计") + "&resource_id=" + connector, user},
	} {
		filtered := request(t, s, resourceUsagePath+"?"+tc.query, 200)
		rows := filtered["items"].([]any)
		if len(rows) == 0 {
			t.Fatalf("用户筛选不应为空: %s", tc.query)
		}
		for _, row := range rows {
			if row.(map[string]any)["user_id"] != tc.user {
				t.Fatalf("用户筛选串号: %s: %v", tc.query, filtered)
			}
		}
		if !strings.Contains(tc.query, "resource_id=") {
			want := 10.0
			if tc.user == other {
				want = 100
			}
			number(t, filtered, "data_freshness_seconds", want)
		}
	}
	for _, query := range []string{"user=not-a-user", "user_id=" + user + "&user=other", "user=" + url.QueryEscape(strings.Repeat("用", 200))} {
		empty := request(t, s, resourceUsagePath+"?"+query, 200)
		if len(empty["items"].([]any)) != 0 || empty["data_freshness_seconds"] != nil {
			t.Fatalf("无匹配用户应返回空结果: %v", empty)
		}
	}
	seen := map[string]bool{}
	path := resourceUsagePath + "?limit=1"
	for pages := 0; ; pages++ {
		if pages >= len(items) {
			t.Fatal("游标未终止")
		}
		page := request(t, s, path, 200)
		rows := page["items"].([]any)
		if len(rows) != 1 {
			t.Fatalf("分页行数错误: %v", page)
		}
		key := rows[0].(map[string]any)["sort_key"].(string)
		if seen[key] {
			t.Fatalf("不同用户行不能共享游标: %s", key)
		}
		seen[key] = true
		if page["next_cursor"] == nil {
			break
		}
		cursor := url.QueryEscape(page["next_cursor"].(string))
		request(t, s, resourceUsagePath+"?limit=1&user=other&cursor="+cursor, 400)
		path = resourceUsagePath + "?limit=1&cursor=" + cursor
	}
	if len(seen) != len(items) {
		t.Fatalf("分页遗漏: %d/%d", len(seen), len(items))
	}
	legacy, err := parseReportingFilter(httptest.NewRequest("GET", resourceUsagePath+"?limit=1", nil), s.now())
	if err != nil {
		t.Fatal(err)
	}
	request(t, s, resourceUsagePath+"?limit=1&cursor="+legacy.encodeCursor(reportCursor{Key: "old-grouping"}), 400)
	// Tool-only resources remain searchable without matching snapshot entries.
	exec(t, s, `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,resource_id,calls,failed,duration_ms)
		VALUES($1,1,2,'local_mcp','local-only',3,0,1)`, a)
	local := request(t, s, resourceUsagePath+"?resource_id=local-only&user_id="+user, 200)
	if len(local["items"].([]any)) != 1 {
		t.Fatalf("无快照工具的资源筛选丢失: %v", local)
	}
	number(t, local["items"].([]any)[0].(map[string]any), "calls", 3)
}
