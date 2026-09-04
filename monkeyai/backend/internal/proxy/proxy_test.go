package proxy

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestProxyForwardsRequest(t *testing.T) {
	var gotPath, gotQuery, gotAuthorization, gotAPIKey, gotBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		gotAuthorization = r.Header.Get("Authorization")
		gotAPIKey = r.Header.Get("X-Api-Key")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		gotBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"chat_test","choices":[]}`)
	}))
	t.Cleanup(upstream.Close)

	var gotCredential, gotModel string
	resolver := ResolverFunc(func(_ context.Context, credential, requestedModel string) (Target, error) {
		gotCredential = credential
		gotModel = requestedModel
		return testTarget(upstream.URL + "/gateway/v1?api-version=2026-09-01"), nil
	})
	proxy := NewProxy(resolver, discardLogger())
	body := `{"model":"gpt-5","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions?trace=1", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer runtime-secret")
	recorder := httptest.NewRecorder()

	proxy.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if gotCredential != "runtime-secret" || gotModel != "gpt-5" {
		t.Fatalf("resolve = credential:%q model:%q", gotCredential, gotModel)
	}
	if gotPath != "/gateway/v1/chat/completions" {
		t.Fatalf("upstream path = %q", gotPath)
	}
	if gotQuery != "api-version=2026-09-01&trace=1" {
		t.Fatalf("upstream query = %q", gotQuery)
	}
	if gotAuthorization != "Bearer upstream-secret" || gotAPIKey != "upstream-secret" {
		t.Fatalf("upstream credentials = authorization:%q x-api-key:%q", gotAuthorization, gotAPIKey)
	}
	if gotBody != body {
		t.Fatalf("upstream body = %q", gotBody)
	}
}

func TestProxyRecordsUsage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{
			"id":"chat_usage",
			"usage":{
				"prompt_tokens":11,
				"completion_tokens":7,
				"prompt_tokens_details":{"cached_tokens":5},
				"completion_tokens_details":{"reasoning_tokens":3}
			}
		}`)
	}))
	t.Cleanup(upstream.Close)

	usage := &usageRecorderStub{calls: make(chan Call, 1)}
	proxy := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
		return testTarget(upstream.URL + "/v1"), nil
	}), discardLogger()).WithUsageRecorder(usage)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5"}`))
	req.Header.Set("Authorization", "Bearer runtime-secret")
	recorder := httptest.NewRecorder()

	proxy.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	select {
	case call := <-usage.calls:
		if call.ModelID != "model-1" || call.UserID != "user-1" || call.SessionID != "session-1" {
			t.Fatalf("call identity = %#v", call)
		}
		if call.RequestID != "chat_usage" || call.InputTokens != 11 || call.OutputTokens != 7 || call.CachedInputTokens != 5 {
			t.Fatalf("call usage = %#v", call)
		}
		if call.StartedAt.IsZero() || call.CompletedAt.Before(call.StartedAt) {
			t.Fatalf("call time = %s - %s", call.StartedAt, call.CompletedAt)
		}
	case <-time.After(time.Second):
		t.Fatal("未收到模型调用用量")
	}
}

func TestProxyRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		credential string
		resolver   Resolver
		want       int
	}{
		{name: "method", method: http.MethodGet, path: "/v1/responses", want: http.StatusMethodNotAllowed},
		{name: "path", method: http.MethodPost, path: "/v1/unknown", want: http.StatusNotFound},
		{name: "credential", method: http.MethodPost, path: "/v1/responses", body: `{}`, want: http.StatusUnauthorized},
		{name: "body", method: http.MethodPost, path: "/v1/responses", body: `{`, credential: "key", want: http.StatusBadRequest},
		{name: "null body", method: http.MethodPost, path: "/v1/responses", body: `null`, credential: "key", want: http.StatusBadRequest},
		{
			name:       "unauthorized",
			method:     http.MethodPost,
			path:       "/v1/responses",
			body:       `{"model":"gpt-5"}`,
			credential: "key",
			resolver: ResolverFunc(func(context.Context, string, string) (Target, error) {
				return Target{}, errors.New("not found")
			}),
			want: http.StatusUnauthorized,
		},
		{
			name:       "invalid upstream",
			method:     http.MethodPost,
			path:       "/v1/responses",
			body:       `{"model":"gpt-5"}`,
			credential: "key",
			resolver: ResolverFunc(func(context.Context, string, string) (Target, error) {
				return testTarget("file:///etc/passwd"), nil
			}),
			want: http.StatusBadGateway,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			proxy := NewProxy(test.resolver, discardLogger())
			req := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			if test.credential != "" {
				req.Header.Set("Authorization", "Bearer "+test.credential)
			}
			recorder := httptest.NewRecorder()
			proxy.ServeHTTP(recorder, req)
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d, body = %s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
}

func TestProxyRegister(t *testing.T) {
	proxy := NewProxy(nil, discardLogger())
	router := chi.NewRouter()
	proxy.Register(router)
	for _, endpoint := range endpoints {
		req := httptest.NewRequest(http.MethodPost, endpoint.path, strings.NewReader(`{}`))
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("route %s status = %d", endpoint.path, recorder.Code)
		}
	}
}

func TestProxyChainConfiguration(t *testing.T) {
	proxy := NewProxy(nil, discardLogger())
	recorder := &usageRecorderStub{calls: make(chan Call, 1)}
	transport := http.DefaultTransport
	if got := proxy.WithUsageRecorder(recorder).WithTransport(transport); got != proxy {
		t.Fatal("链式调用未返回原 Proxy")
	}
	if proxy.recorder != recorder || proxy.reverse.Transport != transport {
		t.Fatal("链式配置未生效")
	}
}

func testTarget(baseURL string) Target {
	return Target{
		ModelID:   "model-1",
		UserID:    "user-1",
		SessionID: "session-1",
		BaseURL:   baseURL,
		APIKey:    "upstream-secret",
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type usageRecorderStub struct {
	calls chan Call
}

func (r *usageRecorderStub) Record(_ context.Context, call Call) error {
	r.calls <- call
	return nil
}
