package agentconfig

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestCatalogFailureIsolation(t *testing.T) {
	r, user, _ := catalogDatabase(t)
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	var logs bytes.Buffer
	logger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(logger) })

	var calls atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		if req.Header.Get("X-Account") == "bad" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		var in struct {
			ID     json.RawMessage
			Method string
		}
		if err := json.NewDecoder(req.Body).Decode(&in); err != nil {
			t.Error(err)
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
			result["tools"] = []resource.Object{{"name": "healthy", "inputSchema": resource.Object{"type": "object"}}}
		}
		resource.JSON(req.Context(), w, http.StatusOK, resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}))
	t.Cleanup(remote.Close)

	connector, good, bad, expert := resource.ID(), resource.ID(), resource.ID(), resource.ID()
	catalogExec(t, r, "INSERT INTO connectors(id,owner_user_id,ownership_type,name,url,authorization_mode,authorization_method) VALUES($1,$2,'user','多凭证连接',$3,'independent','http_header')", connector, user, remote.URL)
	for _, credential := range []struct{ id, account string }{{good, "good"}, {bad, "bad"}} {
		headers, _ := json.Marshal(map[string]string{"X-Account": credential.account})
		catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,http_headers,config_revision) VALUES($1,$2,$3,$4::jsonb,1)", credential.id, connector, user, string(headers))
	}
	catalogExec(t, r, "INSERT INTO experts(id,owner_user_id,ownership_type,name,description,prompt,created_by_user_id) VALUES($1,$2,'user','故障隔离专家','测试连接故障隔离','保持正常业务',$2)", expert, user)
	catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id,required) VALUES($1,$2,true)", expert, connector)
	handler := catalogHandler(t, r, user)

	list := catalogRead(t, handler, user, "/connectors", "")
	var catalog struct{ Connectors []resource.Object }
	if err := json.Unmarshal(list.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Connectors) != 2 {
		t.Fatalf("故障不应丢失连接或内置知识库: %s", list.Body.String())
	}
	for _, conn := range catalog.Connectors {
		if conn.String("id") == connector {
			credentials := conn["credentials"].([]any)
			if len(credentials) != 2 {
				t.Fatalf("故障不应丢失凭证: %v", conn)
			}
			for _, raw := range credentials {
				cred := resource.Object(raw.(map[string]any))
				assertEmptyCatalogTools(t, cred)
			}
		}
		assertEmptyCatalogTools(t, conn)
	}
	if calls.Load() != 0 || logs.Len() != 0 {
		t.Fatalf("连接列表不应访问远端或产生发现失败日志: calls=%d logs=%s", calls.Load(), logs.String())
	}
	catalogRead(t, handler, user, "/experts", "")
	manifest := catalogRead(t, handler, user, "/experts/"+expert+"/manifest", "")
	var view resource.Object
	if err := json.Unmarshal(manifest.Body.Bytes(), &view); err != nil || !view.Bool("available") {
		t.Fatalf("故障不应阻断专家清单: %v, %v", view, err)
	}

	for _, credential := range []string{good, bad} {
		input := resource.Object{"expert_id": expert, "connector_bindings": map[string]any{connector: credential}}
		body, _ := json.Marshal(input)
		req := httptest.NewRequest("POST", "/resources/resolve", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+user)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("凭证 %s 不应阻断解析: %d %s", credential, w.Code, w.Body.String())
		}
		var resolved resource.Object
		if err := json.Unmarshal(w.Body.Bytes(), &resolved); err != nil || !resolved.Bool("available") {
			t.Fatalf("解析应保持可用: %v, %v", resolved, err)
		}
		conn := resource.Object(resolved["connectors"].([]any)[0].(map[string]any))
		if conn.String("credential_id") != credential {
			t.Fatalf("不应自动切换凭证: %v", conn)
		}
		tools := conn["tools"].([]any)
		if credential == good && len(tools) != 1 || credential == bad && (len(tools) != 0 || conn.String("connection_status") != "error") {
			t.Fatalf("所选凭证的故障状态或工具不正确: %v", conn)
		}
	}
	for _, value := range []string{"mcp.catalog.tools.failed", "WARN", connector, bad, "mcp_upstream_unavailable"} {
		if !strings.Contains(logs.String(), value) {
			t.Fatalf("降级日志缺少 %s: %s", value, logs.String())
		}
	}

	catalogExec(t, r, "UPDATE connector_credentials SET http_headers='{\"X-Account\":\"good\"}' WHERE id=$1", bad)
	before := calls.Load()
	unchanged := catalogRead(t, handler, user, "/connectors", list.Header().Get("ETag"))
	if unchanged.Code != http.StatusNotModified || calls.Load() != before {
		t.Fatal("远端状态变化不应影响连接列表 ETag 或触发远端查询")
	}
}
