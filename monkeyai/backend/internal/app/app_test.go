package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type pingerStub struct{}

func (pingerStub) Ping(context.Context) error { return nil }

func TestPprofRegistered(t *testing.T) {
	recorder := httptest.NewRecorder()
	http.DefaultServeMux.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil),
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestImageProxyRegistered(t *testing.T) {
	handler := newHandler(slog.New(slog.NewTextHandler(io.Discard, nil)), pingerStub{})
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodPost, "/v1/images/generations", `{"model":"image@id","prompt":"猫"}`},
		{http.MethodPost, "/v1/images/edits", `{"model":"image@id","prompt":"修改","images":[{"file_id":"file-id"}]}`},
		{http.MethodGet, "/v1/images/tasks/job-id", ""},
		{http.MethodGet, "/v1/images/outputs/output-id", ""},
		{http.MethodPost, "/v1/images/inputs", ""},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		request.Header.Set("Authorization", "Bearer test")
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusServiceUnavailable {
			t.Errorf("%s %s status = %d", tc.method, tc.path, recorder.Code)
		}
	}
}

func TestProxyRegistered(t *testing.T) {
	handler := newHandler(slog.New(slog.NewTextHandler(io.Discard, nil)), pingerStub{})
	for _, path := range []string{
		"/v1/chat/completions",
		"/v1/responses",
		"/v1/messages",
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"model":"test"}`))
		request.Header.Set("Authorization", "Bearer test")
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusServiceUnavailable {
			t.Errorf("POST %s status = %d", path, recorder.Code)
		}
	}
}
