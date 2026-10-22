package stats

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestResourceKindRejectsLongValues(t *testing.T) {
	for _, value := range []string{strings.Repeat("k", 129), strings.Repeat("类", 43)} {
		request(t, &Service{now: time.Now}, resourceUsagePath+"?kind="+url.QueryEscape(value), 400)
	}
}

func TestResourceKindFilters(t *testing.T) {
	s, user, _ := fixture(t)
	other := resource.ID()
	exec(t, s, `INSERT INTO users(id,name,email) VALUES($1,'分类用户','kind-other@example.com')`, other)
	kinds := []string{"model", "rule", "skill", "expert", "connector", "builtin", "workflow", "agent", "local_mcp", "knowledge", "knowledge_base", "custom.kind", "unknown"}
	var modelSessions []string
	for index, kind := range kinds {
		for userIndex, owner := range []string{user, other} {
			id := resource.ID()
			conversationSession(t, s, owner, id, "类别筛选", s.now().Add(-30*24*time.Hour))
			namedSnapshot(t, s, id, "snapshot", kind, "shared-resource", "v1", "上报名称")
			conversationTurn(t, s, id, 1, s.now().Add(-time.Hour), "complete", "正文", 1, 1)
			received := time.Duration(index*10+userIndex*100+1) * time.Second
			exec(t, s, `UPDATE session_turns SET received_at=$2 WHERE session_id=$1`, id, s.now().Add(-received))
			if kind == "model" {
				modelSessions = append(modelSessions, id)
			}
			if kind == "builtin" || kind == "workflow" || kind == "agent" || kind == "local_mcp" {
				exec(t, s, `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,resource_id,resource_version,calls,failed,duration_ms)
					VALUES($1,1,0,$2,'shared-resource','v1',3,1,1)`, id, kind)
			}
			if kind == "skill" {
				exec(t, s, `INSERT INTO session_skill_events(session_id,turn_index,ordinal,skill_id,version,trigger,ok)
					VALUES($1,1,0,'shared-resource','v1','user',true)`, id)
			}
		}
	}
	// These facts have no matching snapshot category and use the freshest model turn.
	exec(t, s, `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,resource_id,calls,failed,duration_ms)
		VALUES($1,1,0,'local_mcp','tool-only',2,0,1)`, modelSessions[0])
	exec(t, s, `INSERT INTO session_skill_events(session_id,turn_index,ordinal,skill_id,trigger,ok)
		VALUES($1,1,0,'event-only','user',true)`, modelSessions[0])
	connector, tool := resource.ID(), resource.ID()
	exec(t, s, `INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode) VALUES($1,$2,'分类连接器','https://example.com','none')`, connector, user)
	exec(t, s, `INSERT INTO mcp_tools(id,connector_id,name,config_revision) VALUES($1,$2,'tool',1)`, tool, connector)
	for index, session := range modelSessions {
		owner := []string{user, other}[index]
		exec(t, s, `INSERT INTO mcp_tool_calls(session_id,user_id,connector_id,tool_id,status,started_at,completed_at)
			VALUES($1,$2,$3,$4,'succeeded',$5,$5)`, session, owner, connector, tool, s.now().Add(-time.Minute))
	}
	for index, kind := range kinds {
		out := request(t, s, resourceUsagePath+"?kind="+url.QueryEscape(" "+kind+" "), 200)
		rows := out["items"].([]any)
		want := 2
		if kind == "local_mcp" || kind == "skill" {
			want = 3
		} else if kind == "connector" {
			want = 4
		}
		if len(rows) != want {
			t.Fatalf("类别筛选必须覆盖所有来源: %s: %v", kind, out)
		}
		for _, raw := range rows {
			if raw.(map[string]any)["kind"] != kind {
				t.Fatalf("类别筛选混入其他类别: %s: %v", kind, raw)
			}
		}
		freshness := float64(index*10 + 1)
		if kind == "local_mcp" || kind == "skill" || kind == "connector" {
			freshness = 1
		}
		number(t, out, "data_freshness_seconds", freshness)
	}
	for _, query := range []string{
		"kind=rule&user_id=" + user + "&resource_id=shared-resource&resource_version=v1",
		"kind=rule&user=" + url.QueryEscape("统计用户") + "&resource_id=shared-resource",
		"kind=rule&user=STATS%40EXAMPLE.COM&from=" + url.QueryEscape(s.now().Add(-2*time.Hour).Format(time.RFC3339)) + "&until=" + url.QueryEscape(s.now().Format(time.RFC3339)),
	} {
		out := request(t, s, resourceUsagePath+"?"+query, 200)
		rows := out["items"].([]any)
		if len(rows) != 1 {
			t.Fatalf("类别组合筛选错误: %s: %v", query, out)
		}
		item := rows[0].(map[string]any)
		if item["kind"] != "rule" || item["user_id"] != user || item["resource_name"] != "上报名称" {
			t.Fatalf("组合筛选结果错误: %v", item)
		}
		number(t, item, "enabled_sessions", 1)
	}
	for _, kind := range []string{"missing", "MODEL", "model%_", strings.Repeat("k", 128)} {
		out := request(t, s, resourceUsagePath+"?kind="+url.QueryEscape(kind), 200)
		if len(out["items"].([]any)) != 0 || out["data_freshness_seconds"] != nil {
			t.Fatalf("类别应按原值精确匹配，无匹配时不应返回其他类别的新鲜度: %s: %v", kind, out)
		}
	}
	all := request(t, s, resourceUsagePath+"?kind=", 200)
	if len(all["items"].([]any)) != 30 {
		t.Fatalf("空类别应展示全部来源: %v", all)
	}
	seen := map[string]bool{}
	path := resourceUsagePath + "?kind=skill&limit=1"
	for count := 0; ; count++ {
		if count >= 3 {
			t.Fatal("类别分页未正确终止")
		}
		out := request(t, s, path, 200)
		rows := out["items"].([]any)
		if len(rows) != 1 || rows[0].(map[string]any)["kind"] != "skill" {
			t.Fatalf("应先按类别过滤，再分页: %v", out)
		}
		key := rows[0].(map[string]any)["sort_key"].(string)
		if seen[key] {
			t.Fatalf("类别分页重复: %s", key)
		}
		seen[key] = true
		if out["next_cursor"] == nil {
			break
		}
		cursor := url.QueryEscape(out["next_cursor"].(string))
		request(t, s, resourceUsagePath+"?kind=rule&limit=1&cursor="+cursor, 400)
		path = resourceUsagePath + "?kind=skill&limit=1&cursor=" + cursor
	}
	if len(seen) != 3 {
		t.Fatalf("类别分页遗漏: %v", seen)
	}
}
