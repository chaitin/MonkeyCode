package proxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnthropicUpstreamPath(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, r.URL.RequestURI())
	}))
	defer upstream.Close()

	for _, tc := range []struct{ name, basePath, want string }{
		{"根地址", "", "/v1/messages"},
		{"旧版本地址", "/v1", "/v1/messages"},
		{"网关前缀", "/gateway/anthropic", "/gateway/anthropic/v1/messages"},
		{"旧网关前缀", "/gateway/anthropic/v1/", "/gateway/anthropic/v1/messages"},
		{"前缀不是版本路径段", "/gateway/proxyv1", "/gateway/proxyv1/v1/messages"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
				return Target{BaseURL: upstream.URL + tc.basePath + "?source=test", Protocol: "anthropic"}, nil
			}), discardLogger())
			req := httptest.NewRequest(http.MethodPost, "/v1/messages?beta=true", strings.NewReader(`{"model":"test-model"}`))
			req.Header.Set("X-Api-Key", "test-key")
			w := httptest.NewRecorder()
			p.ServeHTTP(w, req)
			if want := tc.want + "?source=test&beta=true"; w.Code != http.StatusOK || w.Body.String() != want {
				t.Fatalf("转发结果 = %d %q，期望 %q", w.Code, w.Body.String(), want)
			}
		})
	}
}
