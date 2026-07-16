package request

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestClientPropagatesTraceContext(t *testing.T) {
	var traceparent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceparent = r.Header.Get("traceparent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	tp := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.AlwaysSample()))
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	defer func() { _ = tp.Shutdown(context.Background()) }()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := NewClient(u.Scheme, u.Host, 5*time.Second)
	ctx, span := tp.Tracer("test").Start(context.Background(), "request")
	defer span.End()
	if _, err := Get[map[string]bool](client, ctx, "/"); err != nil {
		t.Fatal(err)
	}
	if traceparent == "" {
		t.Fatal("traceparent is empty")
	}
}
