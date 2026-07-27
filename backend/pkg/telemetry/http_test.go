package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

func TestSanitizeIncomingTrace(t *testing.T) {
	tests := []struct {
		name            string
		path            string
		wantTraceparent bool
	}{
		{name: "public", path: "/api/v1/tasks", wantTraceparent: false},
		{name: "internal", path: "/internal/task-report", wantTraceparent: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
			req.Header.Set("tracestate", "vendor=value")
			req.Header.Set("baggage", "secret=value")
			ctx := e.NewContext(req, httptest.NewRecorder())

			err := SanitizeIncomingTrace(func(c echo.Context) error {
				if got := c.Request().Header.Get("traceparent"); (got != "") != tt.wantTraceparent {
					t.Fatalf("traceparent = %q", got)
				}
				if got := c.Request().Header.Get("baggage"); got != "" {
					t.Fatalf("baggage = %q", got)
				}
				return nil
			})(ctx)
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestTraceHeader(t *testing.T) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{1},
		SpanID:     trace.SpanID{2},
		TraceFlags: trace.FlagsSampled,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), spanContext)
	header := TraceHeader(ctx)
	if got := header.Get("traceparent"); got == "" {
		t.Fatal("traceparent is empty")
	}
	if got := header.Get("baggage"); got != "" {
		t.Fatalf("baggage = %q", got)
	}
}
