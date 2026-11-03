package app

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestApplicationDefaultErrorsUseSelectedLanguage(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := newHandler(logger, nil).(*chi.Mux)
	router.Get("/panic-i18n", func(http.ResponseWriter, *http.Request) { panic("private-panic-detail") })
	for _, tc := range []struct {
		method, path string
		status       int
		en, zh       string
	}{
		{"GET", "/unknown-i18n", 404, "Not found", "不存在"},
		{"POST", "/healthz", 405, "Method not allowed", "方法"},
		{"GET", "/panic-i18n", 500, "internal server error", "内部错误"},
	} {
		for _, locale := range []string{"en-US", "zh-CN"} {
			r := httptest.NewRequest(tc.method, tc.path, nil)
			r.Header.Set("Accept-Language", locale)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			want := tc.en
			if locale == "zh-CN" {
				want = tc.zh
			}
			if w.Code != tc.status || !strings.Contains(w.Body.String(), want) || w.Header().Get("Content-Language") != locale || w.Header().Get("X-Request-ID") == "" || strings.Contains(w.Body.String(), "private-panic-detail") {
				t.Fatalf("%s %s: %d %v %s", locale, tc.path, w.Code, w.Header(), w.Body.String())
			}
		}
	}
}
