package apikey

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/go-chi/chi/v5"
)

func TestTypedRoutesPreserveKeyResponses(t *testing.T) {
	var logs bytes.Buffer
	service := NewService(&storeStub{})
	router := chi.NewRouter()
	router.Use(web.New(logging.New(&logs, slog.LevelWarn)).Middleware)
	service.RegisterAgent(router)
	request := httptest.NewRequest("POST", "/api-keys", strings.NewReader(`{"name":"demo"}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	var created CreatedKey
	if response.Code != 201 || json.Unmarshal(response.Body.Bytes(), &created) != nil || created.APIKey == "" || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("创建响应改变: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(logs.String(), created.APIKey) {
		t.Fatal("日志包含调用密钥")
	}
	list := httptest.NewRecorder()
	router.ServeHTTP(list, httptest.NewRequest("GET", "/api-keys", nil))
	if list.Code != 200 || strings.Contains(list.Body.String(), created.APIKey) || !strings.Contains(list.Body.String(), "api_keys") {
		t.Fatal("列表结构改变或重复返回密钥")
	}
	request = httptest.NewRequest("POST", "/api-keys", strings.NewReader(`{"name":""}`))
	request.Header.Set("Accept-Language", "en-US")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 400 || !strings.Contains(response.Body.String(), "api_key_name_required") || !strings.Contains(response.Body.String(), "A name is required. [trace_id: ") {
		t.Fatalf("未通过公共错误运行时: %s", response.Body.String())
	}
	if strings.Count(logs.String(), `"event":"http.response.error"`) != 1 {
		t.Fatalf("错误摘要不是一条: %s", logs.String())
	}
	deleted := httptest.NewRecorder()
	router.ServeHTTP(deleted, httptest.NewRequest("DELETE", "/api-keys/"+created.ID, nil))
	if deleted.Code != 204 || deleted.Body.Len() != 0 {
		t.Fatal("删除响应改变")
	}
}
