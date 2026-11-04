package i18n

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLanguageNegotiation(t *testing.T) {
	for _, tc := range []struct{ accept, locale, text string }{
		{"", "zh-CN", "该服务不支持自动注册"},
		{"en-GB,en;q=0.9,zh-CN;q=0.2", "en-US", "does not support automatic registration"},
		{"zh-TW,zh;q=0.9", "zh-CN", "该服务不支持自动注册"},
		{"fr-FR,en;q=0.8", "en-US", "does not support automatic registration"},
		{"fr-FR", "zh-CN", "该服务不支持自动注册"},
		{"en;q=0,zh;q=1", "zh-CN", "该服务不支持自动注册"},
	} {
		t.Run(tc.accept, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/v1/connectors", nil)
			r.Header.Set("Accept-Language", tc.accept)
			w := httptest.NewRecorder()
			Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if Locale(r.Context()) != tc.locale {
					t.Fatalf("locale=%s", Locale(r.Context()))
				}
				w.Write([]byte(Text(r.Context(), "oauth_registration_unsupported", "")))
			})).ServeHTTP(w, r)
			if w.Header().Get("Content-Language") != tc.locale || w.Header().Get("Vary") != "Accept-Language" || !strings.Contains(w.Body.String(), tc.text) {
				t.Fatalf("响应未本地化: %v %s", w.Header(), w.Body.String())
			}
		})
	}
}

func TestCatalogAndFallback(t *testing.T) {
	for code, translations := range messages {
		if translations["zh-CN"] == "" || translations["en-US"] == "" {
			t.Fatalf("错误码缺少翻译: %s", code)
		}
	}
	ctx := context.WithValue(t.Context(), localeKey{}, "en-US")
	if text := Text(ctx, "new_server_code", "原始错误 private-token"); text != messages["request_failed"]["en-US"] {
		t.Fatalf("未知码未使用安全英文兜底: %s", text)
	}
	if text := Text(t.Context(), "invalid_request", "字段名称不能为空"); text != "字段名称不能为空" {
		t.Fatalf("原有中文说明未保留: %s", text)
	}
}
