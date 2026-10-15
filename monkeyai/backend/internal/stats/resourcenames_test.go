package stats

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func namedSnapshot(t *testing.T, s *Service, session, snapshot, kind, id string, version any, name string) {
	t.Helper()
	exec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,$2,'[]') ON CONFLICT DO NOTHING`, session, snapshot)
	exec(t, s, `INSERT INTO session_resource_snapshot_items(session_id,snapshot_id,resource_id,kind,version,name,enabled,available)
		VALUES($1,$2,$3,$4,$5,$6,true,true)`, session, snapshot, id, kind, version, name)
}

func TestResourceNamesCatalogAndFallbacks(t *testing.T) {
	s, user, model := fixture(t)
	rule, skill, expert, connector, deleted := resource.ID(), resource.ID(), resource.ID(), resource.ID(), resource.ID()
	exec(t, s, `UPDATE models SET display_name='生产模型' WHERE id=$1`, model)
	exec(t, s, `INSERT INTO rules(id,ownership_type,owner_user_id,name,content,enabled) VALUES($1,'system',$2,'代码规范','规则正文',false)`, rule, user)
	exec(t, s, `INSERT INTO rules(id,ownership_type,owner_user_id,name,content,deleted_at) VALUES($1,'system',$2,'已删除的后台名称','规则正文',$3)`, deleted, user, s.now())
	exec(t, s, `INSERT INTO skills(id,ownership_type,owner_user_id,name,description,package_file_name,package_s3_key,package_size_bytes,package_sha256)
		VALUES($1,'system',$2,'代码审查','','skill.zip','test',0,$3)`, skill, user, strings.Repeat("a", 64))
	exec(t, s, `INSERT INTO experts(id,owner_user_id,created_by_user_id,name,description,prompt) VALUES($1,$2,$2,'研发专家','','提示词')`, expert, user)
	exec(t, s, `INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode) VALUES($1,$2,'公司知识库','https://example.com','none')`, connector, user)
	id := resource.ID()
	conversationSession(t, s, user, id, "名称解析", s.now().Add(-time.Hour))
	conversationTurn(t, s, id, 1, s.now().Add(-time.Hour), "complete", "正文", 1, 1)
	cases := []struct{ kind, id, report, want string }{
		{"model", strings.ToUpper(model), "旧模型名称", "生产模型"},
		{"rule", rule, "旧规则名称", "代码规范"},
		{"skill", skill, "旧技能名称", "代码审查"},
		{"expert", expert, "旧专家名称", "研发专家"},
		{"connector", connector, "旧连接器名称", "公司知识库"},
		{"rule", deleted, "历史规则名称", "历史规则名称"},
		// A model UUID must not resolve as a rule.
		{"rule", model, "上报的外部规则", "上报的外部规则"},
		{"model", "invalid:uuid", "", "invalid:uuid"},
		{"rule", "missing-name", "   ", "missing-name"},
		{"custom", "custom-resource", "  业务插件  ", "业务插件"},
		{"builtin", "read_file", "读取文件", "read_file"},
	}
	for _, tc := range cases {
		snapshot := "snapshot"
		if tc.kind == "rule" && tc.id == model {
			snapshot = "cross-kind"
			conversationTurn(t, s, id, 2, s.now().Add(-30*time.Minute), "complete", "正文", 1, 1)
		}
		namedSnapshot(t, s, id, snapshot, tc.kind, tc.id, "v1", tc.report)
		if snapshot == "cross-kind" {
			exec(t, s, `UPDATE session_turns SET resources_snapshot_id=$2 WHERE session_id=$1 AND turn_index=2`, id, snapshot)
		}
	}
	exec(t, s, `INSERT INTO session_turn_tools(session_id,turn_index,ordinal,category,resource_id,name,calls,failed,duration_ms)
		VALUES($1,1,0,'local_mcp','local-query','query_database',1,0,1),($1,1,1,'builtin','execute_command','执行命令',1,0,1)`, id)
	exec(t, s, `INSERT INTO session_skill_events(session_id,turn_index,ordinal,skill_id,name,version,trigger,ok)
		VALUES($1,1,0,'event-only','技能旧名称','v2','user',true),($1,1,1,'event-only','技能新名称','v2','model',true),($1,1,2,'event-only','  ','v2','model',true)`, id)
	want := map[string]string{}
	for _, tc := range cases {
		want[tc.kind+"|"+tc.id] = tc.want
	}
	want["local_mcp|local-query"] = "query_database"
	want["builtin|execute_command"] = "execute_command"
	want["skill|event-only"] = "技能新名称"
	out := request(t, s, resourceUsagePath, 200)
	items := out["items"].([]any)
	if len(items) != len(want) {
		t.Fatalf("名称补全不应新增或丢失行: %v", out)
	}
	keys := map[string]string{}
	for _, raw := range items {
		item := raw.(map[string]any)
		key := item["kind"].(string) + "|" + item["resource_id"].(string)
		if item["resource_name"] != want[key] {
			t.Fatalf("%s 名称错误: got=%v want=%s", key, item["resource_name"], want[key])
		}
		keys[key] = item["sort_key"].(string)
	}
	// Renaming an active resource changes its label without changing identity or counts.
	exec(t, s, `UPDATE rules SET name='新的代码规范' WHERE id=$1`, rule)
	renamed := request(t, s, resourceUsagePath+"?resource_id="+rule, 200)["items"].([]any)[0].(map[string]any)
	if renamed["resource_name"] != "新的代码规范" || renamed["resource_id"] != rule || renamed["sort_key"] != keys["rule|"+rule] {
		t.Fatalf("名称不能改变资源标识或排序键: %v", renamed)
	}
	number(t, renamed, "enabled_sessions", 1)
	number(t, renamed, "calls", 0)
}

func TestResourceNamesReportedScopeAndPagination(t *testing.T) {
	s, user, model := fixture(t)
	other, otherModel := resource.ID(), resource.ID()
	exec(t, s, `INSERT INTO users(id,name,email) VALUES($1,'另一个用户','resource-names@example.com')`, other)
	exec(t, s, `INSERT INTO models(id,ownership_type,owner_user_id,display_name,model_id,protocol,base_url,api_key,advanced_config)
		VALUES($1,'system',$2,'另一个模型','other','openai_chat_completions','https://example.com','test','{}')`, otherModel, user)
	id := resource.ID()
	conversationSession(t, s, user, id, "版本与名称", s.now().Add(-3*time.Hour))
	for index, tc := range []struct {
		snapshot, name, outcome, model string
		at                             time.Time
	}{
		{"old", "旧的工作流名称", "complete", model, s.now().Add(-2 * time.Hour)},
		{"new", "新的工作流名称", "error", otherModel, s.now().Add(-time.Hour)},
		{"blank", "  ", "error", otherModel, s.now().Add(-time.Minute)},
		{"future", "窗口外的名称", "complete", model, s.now()},
	} {
		namedSnapshot(t, s, id, tc.snapshot, "workflow", "shared-flow", "v1", tc.name)
		conversationTurn(t, s, id, index+1, tc.at, tc.outcome, "正文", 1, 1)
		exec(t, s, `UPDATE session_turns SET resources_snapshot_id=$3,model_id=$4 WHERE session_id=$1 AND turn_index=$2`, id, index+1, tc.snapshot, tc.model)
	}
	for _, tc := range []struct {
		user    string
		version any
		name    string
	}{
		{user, "v2", "第二版本的名称"},
		{user, nil, "无版本的名称"},
		{other, "v1", "另一个用户的名称"},
	} {
		session := resource.ID()
		conversationSession(t, s, tc.user, session, "独立名称", s.now().Add(-time.Minute))
		namedSnapshot(t, s, session, "snapshot", "workflow", "shared-flow", tc.version, tc.name)
		conversationTurn(t, s, session, 1, s.now().Add(-time.Minute), "complete", "正文", 1, 1)
	}
	base := resourceUsagePath + "?user_id=" + user + "&resource_id=shared-flow&resource_version=v1"
	for _, tc := range []struct{ suffix, want string }{
		{"", "新的工作流名称"},
		{"&model_id=" + model, "旧的工作流名称"},
		{"&outcome=complete", "旧的工作流名称"},
	} {
		out := request(t, s, base+tc.suffix, 200)
		rows := out["items"].([]any)
		if len(rows) != 1 || rows[0].(map[string]any)["resource_name"] != tc.want {
			t.Fatalf("名称必须来自同一筛选范围内最新的非空上报: %s: %v", tc.suffix, out)
		}
	}
	all := request(t, s, resourceUsagePath, 200)
	want := map[string]string{
		user + "|v1":    "新的工作流名称",
		user + "|v2":    "第二版本的名称",
		user + "|<nil>": "无版本的名称",
		other + "|v1":   "另一个用户的名称",
	}
	if len(all["items"].([]any)) != len(want) {
		t.Fatalf("用户与版本必须独立分组: %v", all)
	}
	seen := map[string]bool{}
	path := resourceUsagePath + "?limit=1"
	for count := 0; ; count++ {
		if count >= len(want) {
			t.Fatal("名称补全破坏了分页终止条件")
		}
		page := request(t, s, path, 200)
		rows := page["items"].([]any)
		if len(rows) != 1 {
			t.Fatalf("名称补全不能影响分页行数: %v", page)
		}
		item := rows[0].(map[string]any)
		key := fmt.Sprint(item["user_id"]) + "|" + fmt.Sprint(item["version"])
		if seen[key] || item["resource_name"] != want[key] {
			t.Fatalf("名称跨用户、版本或游标重复: %v", item)
		}
		seen[key] = true
		if page["next_cursor"] == nil {
			break
		}
		path = resourceUsagePath + "?limit=1&cursor=" + url.QueryEscape(page["next_cursor"].(string))
	}
	if len(seen) != len(want) {
		t.Fatalf("分页遗漏资源名称: %v", seen)
	}
}
