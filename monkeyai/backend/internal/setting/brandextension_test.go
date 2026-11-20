package setting

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

type brandingStub struct{ value json.RawMessage }

func (s brandingStub) Value(context.Context) (json.RawMessage, error) { return s.value, nil }
func (s brandingStub) AdminValue(context.Context, json.RawMessage) (json.RawMessage, error) {
	return s.value, nil
}
func TestGenericSettingsCannotWriteBranding(t *testing.T) {
	service := NewService(nil)
	router := chi.NewRouter()
	service.RegisterAdmin(router)
	for _, tc := range []struct{ method, path string }{
		{"PUT", "/settings/branding"}, {"PUT", "/settings/branding/logo"}, {"DELETE", "/settings/branding/logo"},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}")))
		if response.Code != 404 {
			t.Fatalf("%s %s: %d", tc.method, tc.path, response.Code)
		}
	}
	if _, err := service.Put(t.Context(), "branding", json.RawMessage(`{}`), 1, ""); !errors.Is(err, ErrUnknownKey) {
		t.Fatal("业务方法未拒绝品牌写入")
	}
	if _, err := NewPostgres(nil).Put(t.Context(), Record{Key: "branding"}); !errors.Is(err, ErrUnknownKey) {
		t.Fatal("持久化入口未拒绝品牌写入")
	}
}
func TestExplicitBrandingProvider(t *testing.T) {
	value := json.RawMessage(`{"workspace_name":"示例团队","product_name":"示例产品"}`)
	service := NewService(&memoryStore{records: map[string]Record{"branding": {Key: "branding", Value: json.RawMessage(`{"logo_s3_key":"private"}`)}}}).WithBranding(brandingStub{value})
	got, err := service.GetValue(t.Context(), "branding")
	if err != nil || string(got) != string(value) {
		t.Fatal("未使用显式品牌扩展", err)
	}
	config, err := service.AgentConfig(t.Context())
	if err != nil || string(config.Settings["branding"]) != string(value) {
		t.Fatal("客户端配置未使用品牌扩展", err)
	}
}
