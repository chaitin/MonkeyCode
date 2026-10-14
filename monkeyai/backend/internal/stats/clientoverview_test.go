package stats

import (
	"fmt"
	"net/url"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const clientOverviewPath = "/statistics/session-reporting/clients/overview"

func clientSession(t *testing.T, s *Service, user, clientType, platform string) string {
	t.Helper()
	id := resource.ID()
	conversationSession(t, s, user, id, "客户端统计", s.now().Add(-30*24*time.Hour))
	exec(t, s, `UPDATE sessions SET client_type=$2 WHERE id=$1`, id, clientType)
	if platform != "" {
		machine := resource.ID()
		exec(t, s, `INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version)
			VALUES($1,$2,'test',$3,'test','amd64','device-version',1)`, user, machine, platform)
		exec(t, s, `UPDATE sessions SET device_id=$2 WHERE id=$1`, id, machine)
	}
	return id
}

func clientTurn(t *testing.T, s *Service, id string, index int, at time.Time, outcome string, version any, model any) {
	t.Helper()
	conversationTurn(t, s, id, index, at, outcome, "正文", 1, 1)
	exec(t, s, `UPDATE session_turns SET client_version=$3,model_id=$4,received_at=$5 WHERE session_id=$1 AND turn_index=$2`, id, index, version, model, s.now().Add(-5*time.Minute))
}

func checkClientOverview(t *testing.T, out resource.Object, total int, want map[string]map[string]int) {
	t.Helper()
	number(t, out, "total", float64(total))
	if out["metric"] != "sessions" {
		t.Fatalf("统计口径错误: %v", out)
	}
	groups := out["distributions"].(map[string]any)
	for _, dimension := range []string{"client_type", "platform", "client_version"} {
		items, ok := groups[dimension].([]any)
		if !ok {
			t.Fatalf("%s 应返回数组: %v", dimension, groups[dimension])
		}
		got, sum, previous := map[string]int{}, 0, total+1
		for _, raw := range items {
			item := raw.(map[string]any)
			value := "<null>"
			if item["value"] != nil {
				value = item["value"].(string)
			}
			count := int(item["count"].(float64))
			if count < 1 || count > previous {
				t.Fatalf("数量必须为正且降序: %v", items)
			}
			if _, exists := got[value]; exists {
				t.Fatalf("分类重复: %v", items)
			}
			got[value], sum, previous = count, sum+count, count
		}
		if sum != total {
			t.Fatalf("%s 分类之和 %d 不等于总数 %d", dimension, sum, total)
		}
		if expected, exists := want[dimension]; exists && fmt.Sprint(got) != fmt.Sprint(expected) {
			t.Fatalf("%s: %v，期望 %v", dimension, got, expected)
		}
	}
}

func TestClientOverviewRejectsInvalidFilters(t *testing.T) {
	for _, query := range []string{
		"cursor=", "cursor=invalid", "limit=1", "page=1", "page_size=20", "include_purged=true",
		"from=bad", "from=2026-09-09T00:00:00Z&until=2026-09-08T00:00:00Z",
		"user_id=invalid", "group_id=invalid", "model_id=invalid", "expert_id=invalid",
		"client_type=invalid", "platform=invalid", "outcome=invalid",
	} {
		t.Run(query, func(t *testing.T) { request(t, &Service{now: time.Now}, clientOverviewPath+"?"+query, 400) })
	}
}

func TestClientOverviewEmpty(t *testing.T) {
	s, _, _ := fixture(t)
	out := request(t, s, clientOverviewPath, 200)
	checkClientOverview(t, out, 0, nil)
	if out["data_freshness_seconds"] != nil || out["from"] == nil || out["until"] == nil || out["generated_at"] == nil {
		t.Fatalf("空统计元数据错误: %v", out)
	}
	if _, exists := out["last_received_at"]; exists {
		t.Fatal("不应暴露内部聚合字段")
	}
}

func TestClientOverviewDeduplicationAndFilters(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	group, expert, otherUser, otherModel := resource.ID(), resource.ID(), resource.ID(), resource.ID()
	exec(t, s, `INSERT INTO groups(id,name) VALUES($1,'统计组')`, group)
	exec(t, s, `INSERT INTO experts(id,name,description,prompt,created_by_user_id,owner_user_id) VALUES($1,'专家','','prompt',$2,$2)`, expert, user)
	exec(t, s, `INSERT INTO users(id,name,email,role) VALUES($1,'其他用户','other-client@example.com','user')`, otherUser)
	exec(t, s, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id) VALUES($1,'system','另一个模型','other','openai_chat_completions','https://example.com','test','{}',$2)`, otherModel, user)

	a := clientSession(t, s, user, "desktop", "windows")
	exec(t, s, `UPDATE sessions SET group_id=$2,expert_id=$3 WHERE id=$1`, a, group, expert)
	clientTurn(t, s, a, 1, now.Add(-2*time.Hour), "complete", "1.0.0", model)
	clientTurn(t, s, a, 2, now.Add(-time.Hour), "error", "2.0.0", otherModel)
	// Equal started_at values must resolve by turn_index, not row order.
	clientTurn(t, s, a, 3, now.Add(-time.Hour), "interrupted", "2.1.0", otherModel)
	// Newer versions outside the selected window must not win.
	clientTurn(t, s, a, 4, now.Add(time.Second), "complete", "future", model)
	b := clientSession(t, s, user, "desktop", "windows")
	clientTurn(t, s, b, 1, now.Add(-time.Hour), "complete", "2.1.0", model)
	c := clientSession(t, s, otherUser, "web", "")
	clientTurn(t, s, c, 1, now.Add(-time.Hour), "complete", nil, model)
	d := clientSession(t, s, user, "extension", "macos")
	clientTurn(t, s, d, 1, now.Add(-time.Hour), "complete", "  ", model)
	child := clientSession(t, s, user, "mobile", "android")
	exec(t, s, `UPDATE sessions SET parent_session_id=$2 WHERE id=$1`, child, a)
	clientTurn(t, s, child, 1, now.Add(-time.Hour), "complete", "v3.0.0", model)
	for _, mode := range []string{"deleted", "purged", "placeholder", "unreported", "no-turns", "old"} {
		id := clientSession(t, s, user, "unknown", "")
		if mode != "no-turns" {
			at := now.Add(-time.Hour)
			if mode == "old" {
				at = now.Add(-25 * time.Hour)
			}
			clientTurn(t, s, id, 1, at, "complete", "excluded", model)
		}
		switch mode {
		case "deleted":
			exec(t, s, `UPDATE sessions SET deleted_at=$2 WHERE id=$1`, id, now)
		case "purged":
			exec(t, s, `UPDATE sessions SET purged_at=$2 WHERE id=$1`, id, now)
		case "placeholder":
			exec(t, s, `UPDATE sessions SET placeholder=true WHERE id=$1`, id)
		case "unreported":
			exec(t, s, `UPDATE sessions SET reporting_enabled_at=NULL WHERE id=$1`, id)
		}
	}
	out := request(t, s, clientOverviewPath, 200)
	checkClientOverview(t, out, 5, map[string]map[string]int{
		"client_type":    {"desktop": 2, "web": 1, "extension": 1, "mobile": 1},
		"platform":       {"windows": 2, "<null>": 1, "macos": 1, "android": 1},
		"client_version": {"2.1.0": 2, "<null>": 2, "v3.0.0": 1},
	})
	number(t, out, "data_freshness_seconds", 300)
	for _, test := range []struct {
		query    string
		total    int
		versions map[string]int
	}{
		{"client_type=desktop", 2, map[string]int{"2.1.0": 2}},
		{"platform=macos", 1, map[string]int{"<null>": 1}},
		{"user_id=" + otherUser, 1, map[string]int{"<null>": 1}},
		{"group_id=" + group, 1, map[string]int{"2.1.0": 1}},
		{"expert_id=" + expert, 1, map[string]int{"2.1.0": 1}},
		{"model_id=" + otherModel, 1, map[string]int{"2.1.0": 1}},
		{"outcome=error", 1, map[string]int{"2.0.0": 1}},
		{"client_type=desktop&outcome=complete", 2, map[string]int{"1.0.0": 1, "2.1.0": 1}},
		{"platform=ios", 0, map[string]int{}},
		{"include_placeholders=true", 6, nil},
	} {
		t.Run(test.query, func(t *testing.T) {
			result := request(t, s, clientOverviewPath+"?"+test.query, 200)
			expected := map[string]map[string]int{}
			if test.versions != nil {
				expected["client_version"] = test.versions
			}
			checkClientOverview(t, result, test.total, expected)
		})
	}
	// Resource predicates must filter turns before selecting the last version.
	exec(t, s, `INSERT INTO session_resource_snapshot_items(session_id,snapshot_id,resource_id,kind,version,enabled,available) VALUES($1,'snapshot','resource-1','skill','v1',true,true)`, a)
	checkClientOverview(t, request(t, s, clientOverviewPath+"?resource_id=resource-1&resource_version=v1", 200), 1, nil)
	// Date filtering is [from, until) and uses turn time, not task creation time.
	query := url.Values{"from": {now.Add(-2 * time.Hour).Format(time.RFC3339)}, "until": {now.Add(-time.Hour).Format(time.RFC3339)}}
	checkClientOverview(t, request(t, s, clientOverviewPath+"?"+query.Encode(), 200), 1, map[string]map[string]int{"client_version": {"1.0.0": 1}})
	// More than four categories must remain in the response; only the UI limits legends.
	for i := range 5 {
		id := clientSession(t, s, user, "desktop", "linux")
		clientTurn(t, s, id, 1, now.Add(-time.Hour), "complete", fmt.Sprintf("extra-%d", i), model)
	}
	out = request(t, s, clientOverviewPath, 200)
	checkClientOverview(t, out, 10, nil)
	versions := out["distributions"].(map[string]any)["client_version"].([]any)
	if len(versions) != 8 {
		t.Fatalf("分类不应被前四项限制截断: %v", versions)
	}
}
