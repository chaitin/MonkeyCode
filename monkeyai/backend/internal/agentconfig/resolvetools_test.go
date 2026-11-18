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
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestResolveConnectorTools(t *testing.T) {
	for _, mode := range []string{"none", "centralized", "independent"} {
		t.Run(mode, func(t *testing.T) {
			r, user, other := catalogDatabase(t)
			t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
			var revision atomic.Int32
			var calls atomic.Int32
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				if req.Header.Get("X-Account") == "unselected" {
					t.Error("不应使用未选凭证请求远端")
				}
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
					if revision.Load() == 4 {
						w.WriteHeader(http.StatusUnauthorized)
						return
					}
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
					catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,http_headers,config_revision) VALUES($1,$2,$3,'{\"X-Account\":\"unselected\"}',1)", resource.ID(), connector, owner)
				}
				out, err := r.Resolve(t.Context(), user, in)
				if err != nil || out.Bool("available") {
					t.Fatalf("多份凭证时应要求明确选择: %v, %v", out, err)
				}
				if calls.Load() != 0 {
					t.Fatal("多份凭证未绑定时不应请求远端")
				}
				in["connector_bindings"] = map[string]any{connector: credential}
			}
			catalogExec(t, r, "INSERT INTO mcp_tools(connector_id,credential_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,'hidden',false,0,1)", connector, credential)
			visibleID := resource.ID()
			catalogExec(t, r, "INSERT INTO mcp_tools(id,connector_id,credential_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,$3,'visible',true,5,1)", visibleID, connector, credential)

			c, err := r.mcp.Connector(t.Context(), r.store.Pool, connector, user, false)
			if err != nil {
				t.Fatal(err)
			}
			refresh := func(wantStatus int) {
				t.Helper()
				id, _ := credential.(string)
				if mode == "centralized" {
					id = ""
				}
				_, err := r.mcp.Tools(t.Context(), r.store.Pool, c, user, id, false)
				if wantStatus == 200 && err != nil || wantStatus != 200 && (err == nil || resource.AsError(err).Status != wantStatus) {
					t.Fatalf("刷新工具失败: want=%d, err=%v", wantStatus, err)
				}
			}
			resolve := func(input resource.Object) resource.Object {
				t.Helper()
				before := calls.Load()
				out, err := r.Resolve(t.Context(), user, input)
				if err != nil || calls.Load() != before {
					t.Fatalf("解析必须只读缓存: %v，远端请求次数变化=%d", err, calls.Load()-before)
				}
				return out
			}
			cold := resolve(in)["connectors"].([]resource.Object)[0]
			assertEmptyCatalogTools(t, cold)
			refresh(200)
			out := resolve(in)
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
			if cached := resolve(in); cached.String("version") != out.String("version") {
				t.Fatalf("上游变化在同步前不应改变快照: %v", cached)
			}
			refresh(200)
			updated := resolve(in)
			updatedTools := updated["connectors"].([]resource.Object)[0]["tools"].([]resource.Object)
			current := updatedTools[len(updatedTools)-1]
			if current.String("description") != account+"-1" || current.String("id") != visible.String("id") || updated.String("version") == out.String("version") {
				t.Fatalf("实时工具或清单版本未更新: %v", updated)
			}

			before := calls.Load()
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
					assertEmptyCatalogTools(t, cred)
				}
			}
			assertEmptyCatalogTools(t, items[0])
			if calls.Load() != before {
				t.Fatal("连接列表不应查询远端工具")
			}

			expert := resource.ID()
			catalogExec(t, r, "INSERT INTO experts(id,owner_user_id,ownership_type,name,description,prompt,created_by_user_id) VALUES($1,$2,'user','专家','描述','提示词',$2)", expert, user)
			catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id,required,tool_allowlist) VALUES($1,$2,true,ARRAY['visible'])", expert, connector)
			expertInput := resource.Object{"expert_id": expert}
			if mode == "independent" {
				expertInput["connector_bindings"] = in["connector_bindings"]
			}
			expertOut := resolve(expertInput)
			expertConn := expertOut["connectors"].([]resource.Object)[0]
			expertTools := expertConn["tools"].([]resource.Object)
			if len(expertTools) != 1 || expertTools[0].String("name") != "visible" || expertConn.String("tools_version") != resource.Hash(expertTools) {
				t.Fatalf("专家连接的工具或过滤规则丢失: %v", expertConn)
			}
			catalogExec(t, r, "UPDATE expert_connectors SET tool_denylist=ARRAY['visible'] WHERE expert_id=$1", expert)
			denied := resolve(expertInput)
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
			refresh(502)
			if stale := resolve(in); !stale.Bool("available") || stale.String("version") != updated.String("version") {
				t.Fatalf("临时故障不应覆盖同版本快照: %v", stale)
			}
			revision.Store(4)
			refresh(502)
			assertEmptyCatalogTools(t, resolve(in)["connectors"].([]resource.Object)[0])
			revision.Store(3)
			refresh(200)
			empty := resolve(in)
			emptyTools := empty["connectors"].([]resource.Object)[0]["tools"].([]resource.Object)
			if emptyTools == nil || len(emptyTools) != 0 {
				t.Fatalf("无工具应返回空数组: %v", empty)
			}
			var synced, checked *time.Time
			if mode == "none" {
				err = r.store.Pool.QueryRow(t.Context(), "SELECT tools_synced_at, last_checked_at FROM connectors WHERE id=$1", connector).Scan(&synced, &checked)
			} else {
				err = r.store.Pool.QueryRow(t.Context(), "SELECT tools_synced_at, last_checked_at FROM connector_credentials WHERE id=$1", credential).Scan(&synced, &checked)
			}
			if err != nil || synced == nil || checked != nil {
				t.Fatalf("成功空快照必须记录时间，但不改变连接测试时间: %v, %v, %v", synced, checked, err)
			}
			var count int
			if err := r.store.Pool.QueryRow(t.Context(), "SELECT count(*) FROM mcp_tools WHERE connector_id=$1", connector).Scan(&count); err != nil || count != 2 {
				t.Fatalf("成功空快照应保留原工具配置，count=%d: %v", count, err)
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
