package logging

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

	"github.com/go-chi/chi/v5"
)

func TestHTTPRequestIdentityAndDiagnosticOwnership(t *testing.T) {
	var out bytes.Buffer
	runtime, _ := NewRuntime(&out, slog.LevelDebug, DefaultSettings())
	defer runtime.Close()
	router := chi.NewRouter()
	router.Use(HTTP(runtime.Logger()))
	router.Get("/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		Diagnostic(r.Context(), runtime.Logger(), slog.LevelError, "resource.operation.failed", errors.New("private"))
		w.Header().Set("X-Request-ID", "upstream-forgery")
		w.WriteHeader(503)
	})
	request := httptest.NewRequest("GET", "/items/private?token=secret", nil)
	request.Header.Set("X-Request-ID", "client-forgery")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	id := response.Header().Get("X-Request-ID")
	if len(id) != 32 {
		t.Fatalf("无本地 ID: %q", id)
	}
	rows := records(t, &out)
	if len(rows) != 2 || rows[0]["request_id"] != id || rows[1]["route"] != "/items/{id}" || rows[1]["level"] != "DEBUG" {
		t.Fatalf("关联或诊断归属错误: %v", rows)
	}
	for _, secret := range []string{"private", "secret", "forgery"} {
		if strings.Contains(out.String(), secret) {
			t.Fatal("日志泄漏", secret)
		}
	}
	if s := runtime.Snapshot(); s.Requests != 1 || s.FailedRequests != 1 {
		t.Fatalf("请求计数错误: %+v", s)
	}
}
func TestHTTPPanicAndAbort(t *testing.T) {
	for _, test := range []struct {
		name               string
		committed, control bool
	}{{"未提交", false, false}, {"已提交", true, false}, {"中止", true, true}} {
		t.Run(test.name, func(t *testing.T) {
			var out bytes.Buffer
			logger := New(&out, slog.LevelDebug)
			handler := HTTP(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if test.committed {
					_, _ = io.WriteString(w, "partial")
				}
				if test.control {
					panic(http.ErrAbortHandler)
				}
				panic("secret-panic-value")
			}))
			response := httptest.NewRecorder()
			func() {
				defer func() {
					p := recover()
					if test.committed && p != http.ErrAbortHandler {
						t.Fatal("未保留中止语义", p)
					}
					if !test.committed && p != nil {
						t.Fatal(p)
					}
				}()
				handler.ServeHTTP(response, httptest.NewRequest("GET", "/", nil))
			}()
			if test.committed && response.Code != 200 || !test.committed && response.Code != 500 {
				t.Fatal("伪造状态", response.Code)
			}
			if !test.committed {
				var body struct {
					Error struct{ Code, Message string }
				}
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error.Code != "internal_error" || body.Error.Message != "服务内部错误" || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
					t.Fatalf("异常恢复未返回通用 JSON 错误: %s", response.Body.String())
				}
			}
			if strings.Contains(out.String(), "secret-panic-value") || strings.Contains(response.Body.String(), "secret-panic-value") {
				t.Fatal("panic 泄漏")
			}
		})
	}
}
func TestHTTPWriterCapabilitiesAndStreaming(t *testing.T) {
	var out bytes.Buffer
	handler := HTTP(New(&out, slog.LevelDebug))(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := w.(http.Hijacker); ok {
			t.Fatal("伪装支持 Hijacker")
		}
		if err := http.NewResponseController(w).Flush(); err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(w, "data: hello\n\n")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/", nil))
	if !response.Flushed || response.Body.String() != "data: hello\n\n" || records(t, &out)[0]["status"] != float64(200) {
		t.Fatal("流式行为改变")
	}
}
func TestContextAuthorityAndDuplicateKeys(t *testing.T) {
	var out bytes.Buffer
	state := newObservation()
	ctx := context.WithValue(context.Background(), contextKey{}, state)
	logger := New(&out, slog.LevelDebug).With("request_id", "fake", "module", "first")
	logger.InfoContext(ctx, "测试", "module", "second", "module", "last")
	var row map[string]any
	if err := json.Unmarshal(out.Bytes(), &row); err != nil {
		t.Fatal(err)
	}
	if row["request_id"] != state.id || row["module"] != "last" || strings.Count(out.String(), `"module"`) != 1 || strings.Count(out.String(), `"request_id"`) != 1 {
		t.Fatal("权威字段或重复键错误", out.String())
	}
}
