package agentconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestResolveConnectorTools(t *testing.T) {
	for _, mode := range []string{"none", "centralized", "independent"} {
		t.Run(mode, func(t *testing.T) {
			r, user, other := catalogDatabase(t)
			t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
			var revision atomic.Int32
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var in struct {
					ID     json.RawMessage `json:"id"`
					Method string          `json:"method"`
				}
				if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				result := resource.Object{}
				switch in.Method {
				case "initialize":
					result["protocolVersion"] = "2025-11-25"
				case "notifications/initialized":
					w.WriteHeader(http.StatusAccepted)
					return
				case "tools/list":
					if revision.Load() == 2 {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					description := fmt.Sprintf("%s-%d", req.Header.Get("X-Account"), revision.Load())
					result["tools"] = []resource.Object{
						{"name": "hidden", "inputSchema": resource.Object{"type": "object"}},
						{"name": "visible", "description": description, "inputSchema": resource.Object{"type": "object", "description": description}},
					}
					if revision.Load() == 3 {
						result["tools"] = []resource.Object{}
					}
				}
				resource.JSON(req.Context(), w, http.StatusOK, resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
			}))
			t.Cleanup(remote.Close)

			connector := resource.ID()
			var method any
			if mode != "none" {
				method = "http_header"
			}
			catalogExec(t, r, "INSERT INTO connectors(id,owner_user_id,ownership_type,name,url,authorization_mode,authorization_method) VALUES($1,$2,'user','实时工具',$3,$4,$5)", connector, user, remote.URL, mode, method)
			in := resource.Object{"connector_ids": []string{connector}}
			var credential any
			account := ""
			if mode != "none" {
				credential, account = resource.ID(), mode
				var owner any
				if mode == "independent" {
					owner = user
				}
				headers, _ := json.Marshal(resource.Object{"X-Account": account})
				catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,http_headers,config_revision) VALUES($1,$2,$3,$4::jsonb,1)", credential, connector, owner, string(headers))
			}
			if mode == "independent" {
				for _, owner := range []string{user, other} {
					catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,http_headers,config_revision) VALUES($1,$2,$3,'{\"X-Account\":\"另一账户\"}',1)", resource.ID(), connector, owner)
				}
				out, err := r.Resolve(t.Context(), user, in)
				if err != nil || out.Bool("available") {
					t.Fatalf("多份凭证时应要求明确选择: %v, %v", out, err)
				}
				in["connector_bindings"] = map[string]any{connector: credential}
			}
			catalogExec(t, r, "INSERT INTO mcp_tools(connector_id,credential_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,'hidden',false,0,1)", connector, credential)
			visibleID := resource.ID()
			catalogExec(t, r, "INSERT INTO mcp_tools(id,connector_id,credential_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,$3,'visible',true,5,1)", visibleID, connector, credential)

			out, err := r.Resolve(t.Context(), user, in)
			if err != nil {
				t.Fatal(err)
			}
			conn := out["connectors"].([]resource.Object)[0]
			tools, ok := conn["tools"].([]resource.Object)
			if !ok || len(tools) != 1 || !out.Bool("available") || conn.String("tools_version") != resource.Hash(tools) {
				t.Fatalf("解析未返回所选凭证的启用工具: %v", out)
			}
			visible := tools[len(tools)-1]
			if visible.String("id") != visibleID || visible.String("name") != "visible" || visible.String("description") != account+"-0" || visible["input_schema"] == nil || !visible.Bool("enabled") {
				t.Fatalf("工具定义或凭证不正确: %v", tools)
			}
			if mode != "independent" && visible.Int("credits_per_call") != 5 {
				t.Fatalf("工具单价未保留: %v", visible)
			}
			if mode == "independent" && visible.Int("credits_per_call") != 0 {
				t.Fatalf("独立认证不应收取历史配置中的价格: %v", visible)
			}
			encoded, _ := json.Marshal(out)
			if strings.Contains(string(encoded), "X-Account") || strings.Contains(string(encoded), "http_headers") {
				t.Fatal("解析结果泄漏凭证 Header")
			}

			revision.Store(1)
			updated, err := r.Resolve(t.Context(), user, in)
			if err != nil {
				t.Fatal(err)
			}
			updatedTools := updated["connectors"].([]resource.Object)[0]["tools"].([]resource.Object)
			current := updatedTools[len(updatedTools)-1]
			if current.String("description") != account+"-1" || current.String("id") != visible.String("id") || updated.String("version") == out.String("version") {
				t.Fatalf("实时工具或清单版本未更新: %v", updated)
			}

			items, err := r.list(t.Context(), r.store.Pool, user, "connectors", resource.CatalogFilter{}, []string{connector})
			if err != nil {
				t.Fatal(err)
			}
			if mode == "independent" {
				credentials := items[0]["credentials"].([]resource.Object)
				if len(credentials) != 2 {
					t.Fatalf("连接目录应只包含当前用户的凭证: %v", items)
				}
				for _, cred := range credentials {
					if cred.String("tools_version") != resource.Hash(cred["tools"]) {
						t.Fatalf("内嵌凭证缺少兼容工具版本: %v", cred)
					}
				}
			} else if items[0].String("tools_version") != resource.Hash(items[0]["tools"]) {
				t.Fatal("连接目录缺少兼容工具版本")
			}

			expert := resource.ID()
			catalogExec(t, r, "INSERT INTO experts(id,owner_user_id,ownership_type,name,description,prompt,created_by_user_id) VALUES($1,$2,'user','专家','描述','提示词',$2)", expert, user)
			catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id,required,tool_allowlist) VALUES($1,$2,true,ARRAY['visible'])", expert, connector)
			expertInput := resource.Object{"expert_id": expert}
			if mode == "independent" {
				expertInput["connector_bindings"] = in["connector_bindings"]
			}
			expertOut, err := r.Resolve(t.Context(), user, expertInput)
			if err != nil {
				t.Fatal(err)
			}
			expertConn := expertOut["connectors"].([]resource.Object)[0]
			expertTools := expertConn["tools"].([]resource.Object)
			if len(expertTools) != 1 || expertTools[0].String("name") != "visible" || expertConn.String("tools_version") != resource.Hash(expertTools) {
				t.Fatalf("专家连接的工具或过滤规则丢失: %v", expertConn)
			}
			catalogExec(t, r, "UPDATE expert_connectors SET tool_denylist=ARRAY['visible'] WHERE expert_id=$1", expert)
			denied, err := r.Resolve(t.Context(), user, expertInput)
			if err != nil {
				t.Fatal(err)
			}
			deniedConn := denied["connectors"].([]resource.Object)[0]
			deniedTools := deniedConn["tools"].([]resource.Object)
			if len(deniedTools) != 0 || deniedConn.String("tools_version") != resource.Hash(deniedTools) || denied.String("version") == expertOut.String("version") {
				t.Fatalf("专家拒绝名单应优先于允许名单，并更新版本: %v", denied)
			}

			if mode == "independent" {
				foreign := resource.ID()
				catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,http_headers,config_revision) VALUES($1,$2,$3,'{\"X-Account\":\"其他用户\"}',1)", foreign, connector, other)
				in["connector_bindings"] = map[string]any{connector: foreign}
				if _, err := r.Resolve(t.Context(), user, in); !errors.Is(err, resource.NotFound) {
					t.Fatalf("不应查询其他用户凭证的工具: %v", err)
				}
				in["connector_bindings"] = map[string]any{connector: credential}
			}

			revision.Store(2)
			if _, err := r.Resolve(t.Context(), user, in); err == nil {
				t.Fatal("远端失败不应返回旧工具目录")
			} else {
				var fault *resource.Error
				if !errors.As(err, &fault) || fault.Status != http.StatusBadGateway {
					t.Fatalf("远端失败应返回 502: %v", err)
				}
			}
			revision.Store(3)
			empty, err := r.Resolve(t.Context(), user, in)
			if err != nil {
				t.Fatal(err)
			}
			emptyTools := empty["connectors"].([]resource.Object)[0]["tools"].([]resource.Object)
			if emptyTools == nil || len(emptyTools) != 0 {
				t.Fatalf("无工具应返回空数组: %v", empty)
			}
			var count int
			if err := r.store.Pool.QueryRow(t.Context(), "SELECT count(*) FROM mcp_tools WHERE connector_id=$1", connector).Scan(&count); err != nil || count != 2 {
				t.Fatalf("解析不应持久化工具目录，count=%d: %v", count, err)
			}
		})
	}
}

func TestResolveKnowledgeBaseTools(t *testing.T) {
	r, user, _ := catalogDatabase(t)
	out, err := r.Resolve(t.Context(), user, resource.Object{"connector_ids": []string{knowledgeBaseConnectorID}})
	if err != nil {
		t.Fatal(err)
	}
	tools := out["connectors"].([]resource.Object)[0]["tools"].([]resource.Object)
	if len(tools) != len(kb.MCPTools()) || len(tools) == 0 {
		t.Fatalf("知识库工具目录不完整: %v", tools)
	}
	seen := map[string]bool{}
	for _, tool := range tools {
		id := tool.String("id")
		if id != tool.String("name") || seen[id] || tool["input_schema"] == nil || !tool.Bool("enabled") {
			t.Fatalf("知识库工具格式无效: %v", tool)
		}
		seen[id] = true
	}
}
