package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type liveToolsBilling struct{ calls []Invocation }

func (b *liveToolsBilling) Begin(_ context.Context, in Invocation) (string, error) {
	b.calls = append(b.calls, in)
	return resource.ID(), nil
}
func (*liveToolsBilling) Start(context.Context, string) error                    { return nil }
func (*liveToolsBilling) Finish(context.Context, string, InvocationResult) error { return nil }

func TestLiveTools(t *testing.T) {
	for _, mode := range []string{"none", "centralized", "independent"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			var revision, lists, calls atomic.Int32
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var in request
				_ = json.NewDecoder(r.Body).Decode(&in)
				result := resource.Object{}
				switch in.Method {
				case "initialize":
					result["protocolVersion"] = protocolVersion
				case "notifications/initialized":
					w.WriteHeader(202)
					return
				case "tools/list":
					lists.Add(1)
					if revision.Load() == 2 {
						w.WriteHeader(503)
						return
					}
					description, name := "旧描述", "removed"
					if revision.Load() == 1 {
						description, name = "新描述", "added"
					}
					result["tools"] = []resource.Object{
						{"name": "stable", "description": description, "inputSchema": resource.Object{"type": "object", "description": description}},
						{"name": name, "inputSchema": resource.Object{"type": "object"}},
					}
				case "tools/call":
					calls.Add(1)
					result["content"] = []resource.Object{{"type": "text", "text": "调用成功"}}
				}
				resource.JSON(r.Context(), w, 200, resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
			}))
			defer remote.Close()
			input := resource.Object{"name": "实时工具-" + mode, "url": remote.URL, "authorization_mode": mode, "grants": []resource.Object{{"user_id": f.users["owner"]}}}
			if mode != "none" {
				input["authorization_method"] = "http_header"
			}
			if mode == "centralized" {
				input["credential"] = resource.Object{"name": "集中凭证", "http_headers": resource.Object{"Authorization": "header-secret"}}
			}
			c := f.call("POST", "/admin/connectors", input, "owner", "", 200)
			path := "/agent/connectors/" + c.String("id")
			gateway := "/mcp/connectors/" + c.String("id")
			var credential resource.Object
			if mode == "centralized" {
				credential = centralCredential(c)
			} else if mode == "independent" {
				credential = f.call("POST", path+"/credentials", resource.Object{"name": "独立凭证", "http_headers": resource.Object{"Authorization": "header-secret"}}, "owner", "", 201)
			}
			toolsPath := path + "/tools"
			if credential != nil {
				toolsPath = path + "/credentials/" + credential.String("id") + "/tools"
				gateway += "/credentials/" + credential.String("id")
			}
			keys := apikey.NewService(apikey.NewPostgres(f.pool))
			key, err := keys.Create(t.Context(), f.users["owner"], apikey.CreateInput{Name: "实时目录", Scopes: []string{apikey.ScopeMCPInvoke}})
			if err != nil {
				t.Fatal(err)
			}
			billing := &liveToolsBilling{}
			f.service.RegisterGateway(f.router.(chi.Router), keys, billing)
			rpc := func(method string, params resource.Object, want int) resource.Object {
				t.Helper()
				data, _ := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
				r := httptest.NewRequest("POST", gateway, bytes.NewReader(data))
				r.Header.Set("Authorization", "Bearer "+key.APIKey)
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				f.router.ServeHTTP(w, r)
				if w.Code != want {
					t.Fatalf("MCP %s: %d %s", method, w.Code, w.Body.String())
				}
				out := resource.Object{}
				if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
					t.Fatal(err)
				}
				return out
			}
			storedCount := func(want int) {
				t.Helper()
				var count int
				if err := f.pool.QueryRow(t.Context(), "SELECT count(*) FROM mcp_tools WHERE connector_id=$1", c.String("id")).Scan(&count); err != nil || count != want {
					t.Fatalf("工具目录不应入库，记录数=%d，预期=%d: %v", count, want, err)
				}
			}
			items := f.call("GET", toolsPath, nil, "owner", "", 200)["items"].([]any)
			stable := resource.Object(items[1].(map[string]any))
			storedCount(0)
			revision.Store(1)
			before := lists.Load()
			out := rpc("tools/list", nil, 200)
			tools := out["result"].(map[string]any)["tools"].([]any)
			if lists.Load() != before+1 || len(tools) != 2 || tools[0].(map[string]any)["name"] != "added" || tools[1].(map[string]any)["description"] != "新描述" {
				t.Fatalf("工具目录未实时更新: %v", out)
			}
			items = f.call("GET", toolsPath, nil, "owner", "", 200)["items"].([]any)
			if len(items) != 2 || items[1].(map[string]any)["description"] != "新描述" {
				t.Fatalf("REST 返回旧目录: %v", items)
			}
			if mode == "centralized" {
				f.call("GET", path+"/tools", nil, "owner", "", 200)
			}
			rpc("tools/call", resource.Object{"name": "stable"}, 200)
			if calls.Load() != 1 || len(billing.calls) != 1 || billing.calls[0].ToolName != "stable" {
				t.Fatal("工具未正常调用或未保留计费名称")
			}
			storedCount(0)
			adminPath := "/admin/connectors/" + c.String("id")
			wantStored := 0
			if mode != "independent" {
				f.call("PATCH", adminPath+"/tools/"+stable.String("id"), resource.Object{"name": "stable", "enabled": false, "credits_per_call": 0}, "owner", "", 200)
				wantStored = 1
				out = rpc("tools/call", resource.Object{"name": "stable"}, 200)
				if out["error"] == nil || calls.Load() != 1 {
					t.Fatal("禁用工具仍被调用")
				}
				tools = rpc("tools/list", nil, 200)["result"].(map[string]any)["tools"].([]any)
				if len(tools) != 1 || tools[0].(map[string]any)["name"] != "added" {
					t.Fatal("本地开关未应用")
				}
				views := f.call("GET", adminPath+"/tools", nil, "owner", "", 200)["items"].([]any)
				if len(views) != 2 || views[1].(map[string]any)["enabled"] != false {
					t.Fatal("管理端未返回禁用工具")
				}
				f.call("POST", adminPath+"/test", nil, "owner", "", 200)
				f.call("PATCH", adminPath+"/tools/"+stable.String("id"), resource.Object{"name": "stable", "enabled": true, "credits_per_call": 0}, "owner", "", 200)
			} else {
				f.call("PATCH", adminPath+"/tools/"+stable.String("id"), resource.Object{"name": "stable", "enabled": false, "credits_per_call": 0}, "owner", "", 400)
				f.call("POST", path+"/credentials/"+credential.String("id")+"/test", nil, "owner", "", 200)
			}
			storedCount(wantStored)
			before = lists.Load()
			rpc("tools/list", resource.Object{"cursor": "invalid"}, 200)
			if lists.Load() != before {
				t.Fatal("无效游标触发远端查询")
			}
			revision.Store(2)
			rpc("tools/list", nil, 502)
			f.call("GET", toolsPath, nil, "owner", "", 502)
			storedCount(wantStored)
		})
	}
}
