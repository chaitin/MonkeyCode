package setting

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAgentSettingsEndpoint(t *testing.T) {
	store := &memoryStore{records: map[string]Record{
		"authentication": {Key: "authentication", Value: json.RawMessage(`{"oauth_connections":[{"client_id":"client","client_secret":"private-secret"}]}`)},
		"email":          {Key: "email", Value: json.RawMessage(`{"smtp_host":"smtp.example.com","smtp_password":"private-password"}`)},
		"billing":        {Key: "billing", Value: json.RawMessage(`{"enabled":true,"charging_mode":"local","input_credits_per_million_tokens":1,"quota_overrides":{"user":100},"root_credits":1000,"remote_billing_api_key":"private-key","remote_billing_base_url":"https://private.example.com"}`)},
	}}
	router := chi.NewRouter()
	NewService(store).RegisterAgent(router)
	read := func(match string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/settings", nil)
		r.Header.Set("If-None-Match", match)
		router.ServeHTTP(w, r)
		return w
	}
	first := read("")
	var body map[string]json.RawMessage
	if err := json.Unmarshal(first.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if first.Code != http.StatusOK || len(body) != 2 || body["settings"] == nil || body["version"] == nil {
		t.Fatalf("设置响应无效: %d %s", first.Code, first.Body.String())
	}
	for _, key := range []string{"private", "client_secret", "smtp_password", "quota_overrides", "root_credits", "remote_billing"} {
		if strings.Contains(first.Body.String(), key) {
			t.Fatalf("设置泄露服务端数据: %s", first.Body.String())
		}
	}
	if !strings.Contains(first.Body.String(), `"charging_mode":"local"`) || !strings.Contains(first.Body.String(), `"input_credits_per_million_tokens":1`) {
		t.Fatal("计费公开信息缺失")
	}
	etag := first.Header().Get("ETag")
	store.records["email"] = Record{Key: "email", Value: json.RawMessage(`{"smtp_host":"smtp.example.com","smtp_password":"rotated"}`)}
	if etag == "" || read(etag).Code != http.StatusNotModified {
		t.Fatal("未下发的密钥变化不应影响缓存")
	}
	delete(store.records, "email")
	changed := read(etag)
	if changed.Code != http.StatusOK || changed.Header().Get("ETag") == etag {
		t.Fatal("设置删除后缓存未失效")
	}
}
