package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestCachedToolsList(t *testing.T) {
	for _, mode := range []string{"none", "centralized"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			var lists atomic.Int32
			remote := mcpRemote(t, func() { lists.Add(1) })
			input := resource.Object{
				"name": "缓存目录", "url": remote.URL, "authorization_mode": mode,
				"grants": []resource.Object{{"user_id": f.users["owner"]}},
			}
			if mode == "centralized" {
				input["authorization_method"] = "http_header"
				input["credential"] = resource.Object{"name": "集中凭证", "http_headers": resource.Object{"Authorization": "header-secret"}}
			}
			c := f.call("POST", "/admin/connectors", input, "owner", "", 200)
			f.call("POST", "/admin/connectors/"+c.String("id")+"/test", nil, "owner", "", 200)
			gateway := "/mcp/connectors/" + c.String("id")
			if mode == "centralized" {
				cred := c["credentials"].([]any)[0].(map[string]any)
				gateway += "/credentials/" + cred["id"].(string)
			}
			keys := apikey.NewService(apikey.NewPostgres(f.pool))
			key, err := keys.Create(t.Context(), f.users["owner"], apikey.CreateInput{Name: "缓存目录", Scopes: []string{apikey.ScopeMCPInvoke}})
			if err != nil {
				t.Fatal(err)
			}
			f.service.RegisterGateway(f.router.(chi.Router), keys, nil)
			before := lists.Load()
			for range 2 {
				body := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
				r := httptest.NewRequest("POST", gateway, bytes.NewReader(body))
				r.Header.Set("Authorization", "Bearer "+key.APIKey)
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				f.router.ServeHTTP(w, r)
				var reply struct {
					Result struct {
						Tools []remoteTool `json:"tools"`
					} `json:"result"`
				}
				if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &reply) != nil || len(reply.Result.Tools) != 1 {
					t.Fatalf("未返回已入库工具: %d %s", w.Code, w.Body.String())
				}
			}
			if lists.Load() != before {
				t.Fatal("集中认证或免认证列表触发了上游发现")
			}
		})
	}
}

func TestIndependentToolsRefresh(t *testing.T) {
	for _, ownership := range []string{"system", "user"} {
		for _, method := range []string{"http_header", "oauth"} {
			t.Run(ownership+"/"+method, func(t *testing.T) {
				f := setup(t)
				var revision, lists atomic.Int32
				remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/token" {
						resource.JSON(r.Context(), w, 200, resource.Object{"access_token": "oauth-secret"})
						return
					}
					var in request
					if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
						t.Error(err)
						return
					}
					result := resource.Object{}
					switch in.Method {
					case "initialize":
						result["protocolVersion"] = protocolVersion
					case "notifications/initialized":
						w.WriteHeader(202)
						return
					case "tools/list":
						lists.Add(1)
						want := "Bearer header-secret"
						if method == "oauth" {
							want = "Bearer oauth-secret"
						}
						if r.Header.Get("Authorization") != want {
							t.Error("工具刷新未使用指定凭证")
							w.WriteHeader(401)
							return
						}
						if revision.Load() == 2 {
							w.WriteHeader(503)
							return
						}
						description, name := "before", "removed"
						if revision.Load() == 1 {
							description, name = "after", "added"
						}
						result["tools"] = []resource.Object{
							{"name": "stable", "description": description, "inputSchema": resource.Object{"type": "object", "description": description}},
							{"name": name, "inputSchema": resource.Object{"type": "object"}},
						}
					}
					resource.JSON(r.Context(), w, 200, resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
				}))
				defer remote.Close()
				input := resource.Object{"name": "自动刷新", "url": remote.URL, "authorization_mode": "independent", "authorization_method": method}
				createPath := "/agent/connectors"
				if ownership == "system" {
					createPath = "/admin/connectors"
					input["grants"] = []resource.Object{{"user_id": f.users["owner"]}}
				}
				if method == "oauth" {
					input["oauth_config"] = resource.Object{"client_id": "client", "authorization_url": remote.URL + "/authorize", "token_url": remote.URL + "/token"}
				}
				status := 201
				if ownership == "system" {
					status = 200
				}
				c := f.call("POST", createPath, input, "owner", "", status)
				path := "/agent/connectors/" + c.String("id")
				credentials := []resource.Object{}
				for _, name := range []string{"A", "B"} {
					var cred resource.Object
					if method == "http_header" {
						cred = f.call("POST", path+"/credentials", resource.Object{"name": name, "http_headers": resource.Object{"Authorization": "Bearer header-secret"}}, "owner", "", 201)
					} else {
						auth := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": name}, "owner", "", 200)
						u, _ := url.Parse(auth.String("authorization_url"))
						f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+u.Query().Get("state")+"&code=code", nil, "", "", 200)
						result := f.call("GET", "/agent/connector-authorizations/"+auth.String("id"), nil, "owner", "", 200)
						cred = f.call("GET", path+"/credentials/"+result.String("credential_id"), nil, "owner", "", 200)
					}
					credentials = append(credentials, cred)
				}
				toolsPath := path + "/credentials/" + credentials[0].String("id") + "/tools"
				stored := f.call("GET", toolsPath, nil, "owner", "", 200)["items"].([]any)
				stableID := stored[1].(map[string]any)["id"].(string)
				if ownership == "system" {
					f.call("PATCH", "/admin/connectors/"+c.String("id")+"/tools/"+stableID, resource.Object{"enabled": false, "credits_per_call": "0"}, "owner", "", 200)
				}
				keys := apikey.NewService(apikey.NewPostgres(f.pool))
				key, err := keys.Create(t.Context(), f.users["owner"], apikey.CreateInput{Name: "自动刷新", Scopes: []string{apikey.ScopeMCPInvoke}})
				if err != nil {
					t.Fatal(err)
				}
				f.service.RegisterGateway(f.router.(chi.Router), keys, nil)
				list := func(params resource.Object, status int, code int) []remoteTool {
					t.Helper()
					body, _ := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": params})
					r := httptest.NewRequest("POST", "/mcp/connectors/"+c.String("id")+"/credentials/"+credentials[0].String("id"), bytes.NewReader(body))
					r.Header.Set("Authorization", "Bearer "+key.APIKey)
					r.Header.Set("Content-Type", "application/json")
					w := httptest.NewRecorder()
					f.router.ServeHTTP(w, r)
					var reply struct {
						Result struct {
							Tools []remoteTool `json:"tools"`
						} `json:"result"`
						Error *rpcError `json:"error"`
					}
					if w.Code != status || json.Unmarshal(w.Body.Bytes(), &reply) != nil || (code == 0 && reply.Error != nil) || (code != 0 && (reply.Error == nil || reply.Error.Code != code)) {
						t.Fatalf("工具列表响应错误: %d %s", w.Code, w.Body.String())
					}
					return reply.Result.Tools
				}
				revision.Store(1)
				before := lists.Load()
				list(resource.Object{"cursor": "invalid"}, 200, -32602)
				if lists.Load() != before {
					t.Fatal("无效游标触发了上游发现")
				}
				tools := list(nil, 200, 0)
				want := 2
				if ownership == "system" {
					want = 1
				}
				if lists.Load() != before+1 || len(tools) != want || tools[0].Name != "added" {
					t.Fatalf("未返回刷新后的工具目录: %+v", tools)
				}
				stored = f.call("GET", toolsPath, nil, "owner", "", 200)["items"].([]any)
				if len(stored) != want {
					t.Fatal("刷新后的目录未同步入库")
				}
				var id, description, schemaDescription string
				var enabled bool
				if err := f.pool.QueryRow(t.Context(), `SELECT id,description,input_schema->>'description',enabled FROM mcp_tools WHERE credential_id=$1 AND name='stable' AND deleted_at IS NULL`, credentials[0].String("id")).Scan(&id, &description, &schemaDescription, &enabled); err != nil || id != stableID || description != "after" || schemaDescription != "after" || enabled != (ownership == "user") {
					t.Fatalf("刷新未保留工具 ID、启停或更新描述及 Schema: %s %s %s %t %v", id, description, schemaDescription, enabled, err)
				}
				other := f.call("GET", path+"/credentials/"+credentials[1].String("id")+"/tools", nil, "owner", "", 200)["items"].([]any)
				if len(other) != 2 || other[0].(map[string]any)["name"] != "removed" || other[1].(map[string]any)["description"] != "before" {
					t.Fatal("刷新影响了其他凭证的工具目录")
				}
				revision.Store(2)
				list(nil, 502, -32000)
				if len(f.call("GET", toolsPath, nil, "owner", "", 200)["items"].([]any)) != want {
					t.Fatal("上游失败清除了原有工具目录")
				}
				revision.Store(1)
				if len(list(nil, 200, 0)) != want {
					t.Fatal("上游恢复后未能重新刷新")
				}
			})
		}
	}
}
