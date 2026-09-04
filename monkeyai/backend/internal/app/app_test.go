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
