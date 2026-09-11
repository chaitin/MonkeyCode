package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testMCPAddresses(t *testing.T, pool *pgxpool.Pool, handler http.Handler, users []string, cookie *http.Cookie) {
	t.Helper()
	var calls atomic.Int64
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID     any    `json:"id"`
			Method string `json:"method"`
			Params struct {
				Name string `json:"name"`
			} `json:"params"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			t.Error("上游请求格式错误")
			return
		}
		result := resource.Object{}
		switch in.Method {
		case "initialize":
			result["protocolVersion"] = "2025-11-25"
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			result["tools"] = []resource.Object{{"name": "search", "description": r.Header.Get("X-Account"), "inputSchema": resource.Object{"type": "object"}}}
		case "tools/call":
			calls.Add(1)
			if in.Params.Name != "search" {
				t.Errorf("上游工具名错误: %s", in.Params.Name)
			}
			result["content"] = []resource.Object{{"type": "text", "text": r.Header.Get("X-Account")}}
		}
		resource.JSON(w, 200, resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}))
	defer remote.Close()
	call := func(method, path, token string, body any, status int) resource.Object {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		if method == "DELETE" && strings.Contains(path, "/credentials/") {
			r.Header.Set("If-Match", `"1"`)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s，预期 %d", method, path, w.Code, w.Body.String(), status)
		}
		out := resource.Object{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		assertNoIdentifiers(t, out)
		return out
	}
	input := resource.Object{"name": "全局 MCP 密钥", "scopes": []string{"mcp:invoke"}}
	created := call("POST", "/api/v1/api-keys", "a", input, 201)
	key := created.String("api_key")
	otherKey := call("POST", "/api/v1/api-keys", "b", input, 201).String("api_key")
	call("POST", "/api/v1/api-keys", "a", resource.Object{"name": "旧绑定请求", "scopes": []string{"mcp:invoke"}, "mcp_bindings": []any{}}, 400)
	createConnector := func(name, mode string) resource.Object {
		t.Helper()
		return call("POST", "/api/v1/connectors", "a", resource.Object{"name": name, "url": remote.URL, "authorization_mode": mode, "authorization_method": "http_header"}, 201)
	}
	c1, c2 := createConnector("地址独立连接", "independent"), createConnector("地址免认证连接", "none")
	central := call("POST", "/api/admin/v1/connectors", "", resource.Object{"name": "地址集中连接", "url": remote.URL, "authorization_mode": "centralized", "authorization_method": "http_header", "grants": []resource.Object{{"user_id": users[0]}, {"user_id": users[1]}}}, 200)
	cp := "/api/v1/connectors/" + c1.String("id")
	p2 := "/api/v1/connectors/" + c2.String("id")
	p3 := "/api/admin/v1/connectors/" + central.String("id")
	a := call("POST", cp+"/credentials", "a", resource.Object{"name": "工作", "http_headers": resource.Object{"X-Account": "A"}}, 201)
	b := call("POST", cp+"/credentials", "a", resource.Object{"name": "私人", "http_headers": resource.Object{"X-Account": "B"}}, 201)
	shared := call("POST", p3+"/credentials", "", resource.Object{"name": "集中凭证", "http_headers": resource.Object{"X-Account": "central"}}, 201)
	if shared["user"] != nil {
		t.Fatal("集中凭证不应属于创建它的管理员")
	}
	for _, path := range []string{cp + "/credentials/" + a.String("id"), cp + "/credentials/" + b.String("id"), p2, p3} {
		call("POST", path+"/test", "a", nil, 200)
	}
	enableCentral := func() {
		t.Helper()
		tool := call("GET", p3+"/tools", "", nil, 200)["items"].([]any)[0].(map[string]any)
		call("PATCH", p3+"/tools/"+tool["id"].(string), "", resource.Object{"enabled": true, "credits_per_call": "0"}, 200)
	}
	enableCentral()
	gateway := "/mcp/connectors/" + c1.String("id")
	paths := []string{gateway + "/credentials/" + a.String("id"), gateway + "/credentials/" + b.String("id"), "/mcp/connectors/" + c2.String("id"), "/mcp/connectors/" + central.String("id") + "/credentials/" + shared.String("id")}
	catalogPaths := map[string]bool{}
	catalog := call("GET", "/api/v1/connectors", "a", nil, 200)
	for _, raw := range catalog["connectors"].([]any) {
		connector := resource.Object(raw.(map[string]any))
		if connector["mcp_gateway"] != nil {
			catalogPaths[connector["mcp_gateway"].(map[string]any)["url"].(string)] = true
		}
		if credentials, ok := connector["credentials"].([]any); ok {
			for _, raw := range credentials {
				credential := raw.(map[string]any)
				if credential["mcp_gateway"] != nil {
					catalogPaths[credential["mcp_gateway"].(map[string]any)["url"].(string)] = true
				}
			}
		}
	}
	list := resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
	invoke := resource.Object{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": resource.Object{"name": "search"}}
	for i, path := range paths {
		if !catalogPaths["http://localhost:8080"+path] {
			t.Fatalf("目录缺少凭证地址 %s", path)
		}
		call("POST", path, key, resource.Object{"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": resource.Object{"protocolVersion": "2025-11-25"}}, 200)
		call("POST", path, key, resource.Object{"jsonrpc": "2.0", "method": "notifications/initialized"}, 202)
		tools := call("POST", path, key, list, 200)["result"].(map[string]any)["tools"].([]any)
		if len(tools) != 1 || tools[0].(map[string]any)["name"] != "search" {
			t.Fatalf("凭证目录混用或工具名变化: %v", tools)
		}
		out := call("POST", path, key, invoke, 200)
		if out["result"].(map[string]any)["content"].([]any)[0].(map[string]any)["text"] != []string{"A", "B", "", "central"}[i] {
			t.Fatalf("同一 Key 经不同地址串用凭证: %v", out)
		}
	}
	before := calls.Load()
	call("POST", paths[0], "a", invoke, 401)
	call("POST", paths[0], "", invoke, 401)
	call("POST", paths[0], otherKey, invoke, 404)
	call("POST", paths[2], otherKey, invoke, 404)
	call("POST", paths[2]+"/credentials/"+a.String("id"), key, invoke, 404)
	call("POST", gateway+"/credentials/"+shared.String("id"), key, invoke, 404)
	call("POST", gateway, key, list, 400)
	call("POST", "/mcp/connectors/"+central.String("id"), key, list, 400)
	call("POST", "/mcp", key, list, 404)
	if calls.Load() != before {
		t.Fatal("未授权请求访问了上游")
	}
	call("POST", paths[3], otherKey, list, 200)
	metadata, _ := json.Marshal(call("GET", "/api/v1/api-keys", "a", nil, 200))
	if strings.Contains(string(metadata), key) || strings.Contains(string(metadata), "mcp_bindings") {
		t.Fatal("密钥列表泄露秘密或保留连接绑定")
	}
	rotated := call("POST", "/api/v1/api-keys/"+created.String("id")+"/rotate", "a", nil, 201)
	call("POST", paths[0], key, list, 401)
	key = rotated.String("api_key")
	for _, path := range paths {
		call("POST", path, key, list, 200)
	}
	call("DELETE", cp+"/credentials/"+a.String("id"), "a", nil, 204)
	call("POST", paths[0], key, list, 404)
	call("POST", paths[1], key, list, 200)

	call("DELETE", p3+"/credentials/"+shared.String("id"), "", nil, 204)
	replacement := call("POST", p3+"/credentials", "", resource.Object{"name": "新集中凭证", "http_headers": resource.Object{"X-Account": "new-central"}}, 201)
	call("POST", p3+"/test", "", nil, 200)
	enableCentral()
	call("POST", paths[3], key, list, 404)
	centralPath := "/mcp/connectors/" + central.String("id") + "/credentials/" + replacement.String("id")
	call("POST", centralPath, key, list, 200)

	share := resource.ShareInput{Resources: []resource.ShareResource{{Type: "connector", ID: c1.String("id")}}, UserIDs: []string{users[1]}}
	call("POST", "/api/v1/resources/shares", "a", share, 204)
	call("POST", paths[1], otherKey, list, 404)
	recipient := call("POST", cp+"/credentials", "b", resource.Object{"name": "接收方", "http_headers": resource.Object{"X-Account": "recipient"}}, 201)
	assertShareUser(t, recipient["user"], users[1], "b", "b@example.com")
	call("POST", cp+"/credentials/"+recipient.String("id")+"/test", "b", nil, 200)
	recipientPath := gateway + "/credentials/" + recipient.String("id")
	call("POST", recipientPath, otherKey, list, 200)
	call("POST", recipientPath, key, list, 404)
	call("DELETE", "/api/v1/resources/shares", "a", share, 204)
	call("POST", recipientPath, otherKey, list, 404)
	if _, err := pool.Exec(t.Context(), `UPDATE connectors SET config_revision=config_revision+1 WHERE id=$1`, c1.String("id")); err != nil {
		t.Fatal(err)
	}
	call("POST", paths[1], key, list, 403)
	call("POST", paths[2], key, list, 200)
	call("DELETE", "/api/v1/api-keys/"+rotated.String("id"), "a", nil, 204)
	call("POST", paths[2], key, list, 401)
}
