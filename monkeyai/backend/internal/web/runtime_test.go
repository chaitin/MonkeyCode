package web

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
	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel/trace"
)

func TestRuntimeErrorsHaveSearchableCorrelation(t *testing.T) {
	for _, status := range []int{200, 400, 503} {
		for _, locale := range []string{"zh-CN", "en-US"} {
			var logs bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelWarn}))
			runtime := New(logger)
			var span trace.SpanContext
			handler := runtime.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				span = trace.SpanContextFromContext(r.Context())
				logging.Expected(r.Context())
				// 已有诊断不能抑制错误回包摘要。
				logging.OwnDiagnostic(r.Context())
				JSON(r.Context(), w, status, map[string]any{"error": Body(r.Context(), "invalid_request", "名称必须为字符串")})
			}))
			request := httptest.NewRequest("GET", "/private?token=private-token", nil)
			request.Header.Set("Accept-Language", locale)
			request.Header.Set("traceparent", "00-1234567890abcdef1234567890abcdef-1234567890abcdef-00")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			var record map[string]any
			if json.Unmarshal(logs.Bytes(), &record) != nil {
				t.Fatalf("错误摘要未唯一记录: %s", logs.String())
			}
			id := "1234567890abcdef1234567890abcdef"
			if !span.IsValid() || span.IsRemote() || span.IsSampled() || span.SpanID().String() == "1234567890abcdef" {
				t.Fatal("未创建本地未采样server span")
			}
			if record["correlation_id"] != nil || record["trace_id"] != id || record["event"] != "http.response.error" || record["code"] != "invalid_request" {
				t.Fatalf("日志关联不完整: %s", logs.String())
			}
			if !strings.Contains(response.Body.String(), "[trace_id: "+id+"]") || response.Header().Get("Content-Language") != locale {
				t.Fatalf("回包无法关联: %s", response.Body.String())
			}
			if record["request_id"] != response.Header().Get("X-Request-ID") {
				t.Fatal("本地请求编号丢失")
			}
			if strings.Contains(logs.String(), "private") {
				t.Fatal("摘要包含私有路径或请求参数")
			}
		}
	}
}

func TestGenericHandlersOwnDecodeAndErrors(t *testing.T) {
	var logs bytes.Buffer
	router := chi.NewRouter()
	router.Use(New(logging.New(&logs, slog.LevelWarn)).Middleware)
	api := Routes(router)
	type input struct {
		Name string `json:"name"`
	}
	type output struct {
		ID string `json:"id"`
	}
	called := 0
	root := errors.New("private password and response body")
	api.Post("/keys", func(ctx context.Context, in input) (output, error) {
		called++
		return output{}, BadRequest("api_key_name_required").WithCause(root)
	})
	api.Get("/count", func(context.Context) (int, error) { return 7, nil })
	for _, body := range []string{`{"name":""}`, `null`, `[]`, `{"unknown":1}`, `{} {}`} {
		w := httptest.NewRecorder()
		request := httptest.NewRequest("POST", "/keys", strings.NewReader(body))
		request.Header.Set("Accept-Language", "en-US")
		router.ServeHTTP(w, request)
		if w.Code != 400 || !strings.Contains(w.Body.String(), "[trace_id: ") || strings.Contains(w.Body.String(), "private") {
			t.Fatalf("解码或错误回包异常: %d %s", w.Code, w.Body.String())
		}
	}
	if called != 1 {
		t.Fatalf("无效输入进入了业务: %d", called)
	}
	err := BadRequest("api_key_name_required").WithCause(root)
	if !errors.Is(err, root) {
		t.Fatal("错误链丢失")
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/count", nil))
	if w.Body.String() != "7\n" {
		t.Fatal("成功输出被包装")
	}
	if strings.Contains(logs.String(), "private") {
		t.Fatal("错误摘要泄露底层原文")
	}
}

func TestProtocolFramesAreLoggedIndividually(t *testing.T) {
	var logs bytes.Buffer
	handler := New(logging.New(&logs, slog.LevelWarn)).Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, id := range []string{"first", "second"} {
			message := FrameMessage(r.Context(), "target_busy", "目标繁忙", id)
			if !strings.Contains(message, "[trace_id: ") {
				t.Error("错误帧无编号")
			}
		}
		io.WriteString(w, "unchanged upstream message")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/stream", nil))
	if strings.Count(logs.String(), `"event":"protocol.response.error"`) != 2 || strings.Contains(logs.String(), "http.response.error") {
		t.Fatalf("消息日志被请求级去重或重复: %s", logs.String())
	}
	if response.Body.String() != "unchanged upstream message" {
		t.Fatal("透传内容被重写")
	}
}
