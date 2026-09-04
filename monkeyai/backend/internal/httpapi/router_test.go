package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubPinger struct {
	err error
}

func (p stubPinger) Ping(context.Context) error {
	return p.err
}

func TestHealth(t *testing.T) {
	recorder := httptest.NewRecorder()
	New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		stubPinger{},
		http.NotFoundHandler(),
		http.NotFoundHandler(),
	).
		ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if recorder.Body.String() != "{\"status\":\"ok\"}\n" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestReadyWhenDatabaseUnavailable(t *testing.T) {
	recorder := httptest.NewRecorder()
	New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		stubPinger{err: errors.New("unavailable")},
		http.NotFoundHandler(),
		http.NotFoundHandler(),
	).
		ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestPprofNotExposed(t *testing.T) {
	recorder := httptest.NewRecorder()
	New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		stubPinger{},
		http.NotFoundHandler(),
		http.NotFoundHandler(),
	).
		ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestAPIRoutes(t *testing.T) {
	handler := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		stubPinger{},
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, "admin")
		}),
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, "agent")
		}),
	)

	tests := []struct {
		path string
		want string
	}{
		{path: "/api/admin/v1/status", want: "admin"},
		{path: "/api/agent/v1/status", want: "agent"},
	}
	for _, test := range tests {
		t.Run(test.want, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.path, nil))

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d", recorder.Code)
			}
			if recorder.Body.String() != test.want {
				t.Fatalf("body = %q", recorder.Body.String())
			}
		})
	}
}
