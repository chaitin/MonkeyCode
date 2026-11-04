package web

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func TestMessageDoesNotUseRequestIDAsTraceID(t *testing.T) {
	handler := logging.HTTP(logging.New(io.Discard, slog.LevelWarn))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if logging.RequestID(r.Context()) == "" {
			t.Fatal("测试请求缺少本地请求编号")
		}
		if actual := Message(r.Context(), "invalid_request", "名称必须为字符串"); actual != "名称必须为字符串" {
			t.Fatalf("无有效 span 时不应追加本地编号: %q", actual)
		}
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/test", nil))
}

func TestResponseAdaptersUseNegotiatedLanguage(t *testing.T) {
	for _, locale := range []string{"zh-CN", "en-US"} {
		for _, kind := range []string{"json", "legacy", "plain", "panic"} {
			t.Run(locale+"/"+kind, func(t *testing.T) {
				r := httptest.NewRequest("GET", "/test", nil)
				r.Header.Set("Accept-Language", locale)
				w := httptest.NewRecorder()
				Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch kind {
					case "json":
						json.NewEncoder(w).Encode(map[string]any{"error": Body(r.Context(), "invalid_request", "评分必须为 1 至 5")})
					case "legacy":
						json.NewEncoder(w).Encode(map[string]any{"error": Body(r.Context(), "invalid_request", "评分必须为 1 至 5")})
					case "plain":
						HTTPError(w, r, 405)
					case "panic":
						InternalResponse(r.Context(), w)
					}
				})).ServeHTTP(w, r)
				if w.Header().Get("Content-Language") != locale || strings.TrimSpace(w.Body.String()) == "" {
					t.Fatal("语言或响应丢失")
				}
				if locale == "en-US" && strings.ContainsAny(w.Body.String(), "评分服务请求") {
					t.Fatalf("英文响应出现未翻译文案: %s", w.Body.String())
				}
				if (kind == "json" || kind == "legacy") && !strings.Contains(w.Body.String(), "invalid_request") {
					t.Fatal("业务码被改写")
				}
			})
		}
	}
}
