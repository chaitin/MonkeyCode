package kb

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type testMCPKeys struct {
	token string
	scope string
	user  string
}

func (k testMCPKeys) Authenticate(_ context.Context, token, scope string) (string, error) {
	if token != k.token || scope != k.scope {
		return "", errors.New("invalid key")
	}
	return k.user, nil
}

func mcpTestRouter(token string) http.Handler {
	router := chi.NewRouter()
	service := &Service{}
	service.RegisterMCP(router, testMCPKeys{token: token, scope: "mcp:invoke", user: "user-1"})
	return router
}

func mcpTestRequest(body string, bearer string, contentType bool) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/mcp/kb", strings.NewReader(body))
	request.Header.Set("Accept", "application/json, text/event-stream")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	if contentType {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	mcpTestRouter("valid-key").ServeHTTP(response, request)
	return response
}

func TestKBMCPRequiresInvocationKey(t *testing.T) {
	for _, test := range []struct {
		name   string
		bearer string
	}{
		{name: "missing"},
		{name: "invalid", bearer: "wrong-key"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := mcpTestRequest(`{"jsonrpc":"2.0","id":1,"method":"ping"}`, test.bearer, true)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401: %s", response.Code, response.Body.String())
			}
			if response.Header().Get("WWW-Authenticate") == "" {
				t.Fatal("缺少 WWW-Authenticate")
			}
			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["error"] == nil {
				t.Fatalf("缺少 JSON-RPC error: %#v", body)
			}
		})
	}
}

func TestKBMCPRequiresJSONContentType(t *testing.T) {
	response := mcpTestRequest(`{"jsonrpc":"2.0","id":1,"method":"ping"}`, "valid-key", false)
	if response.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want 415: %s", response.Code, response.Body.String())
	}
}

func TestKBMCPInitializeAndToolsList(t *testing.T) {
	initialize := mcpTestRequest(
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`,
		"valid-key",
		true,
	)
	if initialize.Code != http.StatusOK {
		t.Fatalf("initialize status = %d: %s", initialize.Code, initialize.Body.String())
	}
	var initialized struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
			ServerInfo      struct {
				Name string `json:"name"`
			} `json:"serverInfo"`
		} `json:"result"`
	}
	if err := json.Unmarshal(initialize.Body.Bytes(), &initialized); err != nil {
		t.Fatal(err)
	}
	if initialized.Result.ProtocolVersion != "2025-06-18" || initialized.Result.ServerInfo.Name != "baizhi-office-kb" {
		t.Fatalf("initialize 响应不正确: %#v", initialized.Result)
	}

	list := mcpTestRequest(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`, "valid-key", true)
	if list.Code != http.StatusOK {
		t.Fatalf("tools/list status = %d: %s", list.Code, list.Body.String())
	}
	var result struct {
		Result struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(result.Result.Tools))
	for _, tool := range result.Result.Tools {
		names = append(names, tool.Name)
	}
	want := []string{"kb_create", "kb_list", "kb_list_documents", "kb_get_document", "kb_create_document", "kb_update_document", "kb_delete_document", "kb_search"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("tools = %v, want %v", names, want)
	}
}

func TestKBMCPKbSearchSchemaHasNoRetrievalControls(t *testing.T) {
	var search resource.Object
	for _, tool := range MCPTools() {
		if tool.String("name") == "kb_search" {
			search = tool
			break
		}
	}
	if search == nil {
		t.Fatal("缺少 kb_search 工具")
	}
	payload, err := json.Marshal(search)
	if err != nil {
		t.Fatal(err)
	}
	schema := string(payload)
	for _, field := range []string{"search_mode", "channels", "disable_vector"} {
		if strings.Contains(schema, `"`+field+`"`) {
			t.Fatalf("kb_search 不应暴露请求级检索控制字段 %q: %s", field, schema)
		}
	}
	if !strings.Contains(schema, "自动执行 lexical+vector") {
		t.Fatalf("kb_search 描述应说明自动选择通道: %s", schema)
	}
}

func TestKBMCPDocumentToolsRequireArguments(t *testing.T) {
	for _, tool := range []string{"kb_list_documents", "kb_get_document", "kb_create_document", "kb_update_document", "kb_delete_document"} {
		t.Run(tool, func(t *testing.T) {
			response := mcpTestRequest(
				`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"`+tool+`","arguments":{}}}`,
				"valid-key",
				true,
			)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
			}
			var body struct {
				Result struct {
					IsError           bool           `json:"isError"`
					StructuredContent map[string]any `json:"structuredContent"`
				} `json:"result"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if !body.Result.IsError || body.Result.StructuredContent["code"] != "invalid_request" {
				t.Fatalf("缺少参数时应返回 invalid_request: %s", response.Body.String())
			}
		})
	}
}

func TestKBMCPDocumentListFilters(t *testing.T) {
	kbID, filter, err := mcpDocumentListFilter(map[string]any{
		"kb_id":       " kb-1 ",
		"q":           "制度",
		"status":      "learned",
		"source_type": "file",
		"page":        json.Number("2"),
		"page_size":   json.Number("10"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if kbID != "kb-1" || filter.Query != "制度" || filter.Status != "learned" || filter.SourceType != "file" || filter.Page != 2 || filter.PageSize != 10 {
		t.Fatalf("文档列表参数解析不正确: kbID=%q filter=%+v", kbID, filter)
	}
	if _, _, err := mcpDocumentListFilter(map[string]any{"kb_id": "kb-1", "page": "2"}); err == nil {
		t.Fatal("page 类型错误应返回参数错误")
	}

	for _, tool := range MCPTools() {
		if tool.String("name") != "kb_list_documents" {
			continue
		}
		schema := tool["inputSchema"].(resource.Object)
		properties := schema["properties"].(resource.Object)
		for _, key := range []string{"q", "status", "source_type", "page", "page_size"} {
			if _, ok := properties[key]; !ok {
				t.Fatalf("kb_list_documents 缺少参数 %s", key)
			}
		}
		return
	}
	t.Fatal("缺少 kb_list_documents 工具")
}

func TestKBMCPDocumentInput(t *testing.T) {
	input, err := mcpDocumentInput(map[string]any{
		"kb_id":       "kb-id",
		"title":       "文档标题",
		"source_type": "text",
		"content":     "正文",
		"size_bytes":  json.Number("12"),
		"revision":    json.Number("99"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.KbID != "kb-id" || input.Title != "文档标题" || input.Content != "正文" || input.SizeBytes != 12 {
		t.Fatalf("document input = %+v", input)
	}
	if !mcpDocumentUpdateProvided(map[string]any{"content": "新正文"}) {
		t.Fatal("content 应被视为可更新字段")
	}
	if mcpDocumentUpdateProvided(map[string]any{"document_id": "id"}) {
		t.Fatal("document_id 不能单独构成更新")
	}
}

func TestKBMCPNotificationReturnsAccepted(t *testing.T) {
	response := mcpTestRequest(`{"jsonrpc":"2.0","method":"notifications/initialized"}`, "valid-key", true)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202: %s", response.Code, response.Body.String())
	}
}

func TestKBMCPToolErrorReturnsResult(t *testing.T) {
	response := mcpTestRequest(
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"unknown","arguments":{}}}`,
		"valid-key",
		true,
	)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", response.Code, response.Body.String())
	}
	var body struct {
		Result struct {
			IsError           bool           `json:"isError"`
			StructuredContent map[string]any `json:"structuredContent"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Result.IsError || body.Result.StructuredContent["code"] == nil {
		t.Fatalf("工具错误应返回 isError 结果: %s", response.Body.String())
	}
}

func TestKBMCPDocumentToolsRequireKnowledgeBase(t *testing.T) {
	for _, name := range []string{"kb_get_document", "kb_update_document", "kb_delete_document"} {
		for _, kbID := range []any{nil, "", " ", 123} {
			args := map[string]any{"document_id": resource.ID(), "title": "更新", "kb_id": kbID}
			params, err := json.Marshal(map[string]any{"name": name, "arguments": args})
			if err != nil {
				t.Fatal(err)
			}
			_, err = (&Service{}).callMCPTool(t.Context(), "user", params)
			if err == nil || !strings.Contains(err.Error(), "kb_id") {
				t.Fatalf("%s kb_id=%v: expected kb_id validation error, got %v", name, kbID, err)
			}
		}
	}
}
