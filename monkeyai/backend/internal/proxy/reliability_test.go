package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

type replayTransport struct{ t *testing.T }

func (transport replayTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	t := transport.t
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	if r.GetBody == nil {
		t.Fatal("改写后的请求体不能重放")
	}
	for range 2 {
		replay, err := r.GetBody()
		if err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(replay)
		replay.Close()
		if err != nil || !bytes.Equal(body, got) {
			t.Fatalf("重放与实际发送的请求体不一致: %v", err)
		}
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "upstream-model" || payload["stream_options"] != nil {
		t.Fatal("重放必须使用最终模型且不补充流式参数")
	}
	return &http.Response{StatusCode: 400, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"rejected"}`)), Request: r}, nil
}

func TestReplayUsesPreparedBodyAndKeepsRoute(t *testing.T) {
	var logs bytes.Buffer
	logger := logging.New(&logs, slog.LevelDebug)
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
		return Target{BaseURL: "https://example.com/v1", OwnershipType: "user", UpstreamModel: "upstream-model"}, nil
	}), logger).WithTransport(replayTransport{t})
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"alias","stream":true,"messages":[]}`))
	r.Header.Set("Authorization", "Bearer mk_test")
	logging.HTTP(logger)(p).ServeHTTP(httptest.NewRecorder(), r)
	if !strings.Contains(logs.String(), `"route":"/v1/chat/completions"`) || strings.Contains(logs.String(), `"route":"unmatched"`) {
		t.Fatalf("模型端点丢失: %s", logs.String())
	}
}

type interruptedReader struct{}

func (interruptedReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestUsageDiagnosticsDistinguishRecoveryAndReadFailure(t *testing.T) {
	complete := "event: response.completed\ndata: {\"response\":{\"id\":\"resp-test\",\"usage\":{\"input_tokens\":3,\"output_tokens\":2}}}\n\n"
	for _, tc := range []struct {
		name   string
		reader io.Reader
		want   string
		absent string
	}{
		{"解析恢复", strings.NewReader("event: response.created\ndata: {broken}\n\n" + complete), `"event":"model.usage.parse.recovered"`, `"event":"model.usage.failed"`},
		{"读取中断", io.MultiReader(strings.NewReader("event: response.created\ndata: {\"response\":{\"id\":\"resp-test\"}}\n\n"), interruptedReader{}), `"read_error_count":1`, `"parse_error_count":1`},
		{"结束标记", strings.NewReader(complete + "data: [DONE]\n\n"), `"terminal_event":"response.completed"`, `"event":"model.usage.failed"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			p := NewProxy(nil, logging.New(&logs, slog.LevelDebug))
			c := &usageCapture{logger: p.logger, reader: io.NopCloser(tc.reader), ctx: usageCaptureContext{
				ctx: t.Context(), path: "/v1/responses", stream: true, proxy: p, proxyCtx: &proxyContext{stream: true},
			}}
			c.handleShadow()
			if !strings.Contains(logs.String(), tc.want) || strings.Contains(logs.String(), tc.absent) {
				t.Fatal(logs.String())
			}
		})
	}
}

func TestIncompleteReasonSurvivesKnownUsage(t *testing.T) {
	c := newUsageCaptureForTest("/v1/responses", true, "event: response.incomplete\ndata: {\"response\":{\"id\":\"resp-test\",\"usage\":{\"input_tokens\":3,\"output_tokens\":2},\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n")
	result := c.handleStream()
	if !result.Known || result.FailureCode != "output_limit_reached" {
		t.Fatalf("终止状态丢失: %+v", result)
	}
	var logs bytes.Buffer
	p := NewProxy(nil, logging.New(&logs, slog.LevelDebug))
	p.recordUsage(t.Context(), &proxyContext{}, result)
	if !strings.Contains(logs.String(), `"incomplete_reason":"max_output_tokens"`) {
		t.Fatal(logs.String())
	}
}

func TestCanceledResolutionIsNotUnauthorized(t *testing.T) {
	var logs bytes.Buffer
	logger := logging.New(&logs, slog.LevelDebug)
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) { return Target{}, context.Canceled }), logger)
	r := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"test"}`))
	r.Header.Set("Authorization", "Bearer mk_test")
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	w := httptest.NewRecorder()
	logging.HTTP(logger)(p).ServeHTTP(w, r.WithContext(ctx))
	if w.Code == http.StatusUnauthorized || strings.Contains(logs.String(), `"level":"ERROR"`) || strings.Contains(logs.String(), "解析模型失败") {
		t.Fatal(w.Code, logs.String())
	}
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal(ctx.Err())
	}
}

func TestUpstreamRejectionKeepsResponseAndSafeDiagnostics(t *testing.T) {
	body := `{"error":{"code":"unsupported_value","type":"invalid_request_error","param":"temperature","message":"private-prompt"}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(400); io.WriteString(w, body) }))
	defer server.Close()
	var logs bytes.Buffer
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) { return Target{BaseURL: server.URL}, nil }), logging.New(&logs, slog.LevelDebug))
	r := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"test"}`))
	r.Header.Set("Authorization", "Bearer mk_test")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, r)
	if w.Code != 400 || w.Body.String() != body {
		t.Fatal("代理改动了上游错误响应")
	}
	if !strings.Contains(logs.String(), `"upstream_error_code":"unsupported_value"`) || strings.Contains(logs.String(), "private-prompt") {
		t.Fatal(logs.String())
	}
	if strings.Count(logs.String(), `"event":"model.call.completed"`) != 1 {
		t.Fatal(logs.String())
	}
}
