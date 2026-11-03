package web

import (
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web/internal/i18n"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type Runtime struct {
	logger   *slog.Logger
	provider trace.TracerProvider
}

func New(logger *slog.Logger) *Runtime {
	return &Runtime{logger: logger, provider: sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.NeverSample()))}
}
func (s *Runtime) WithTracerProvider(provider trace.TracerProvider) *Runtime {
	s.provider = provider
	return s
}
func (s *Runtime) Middleware(next http.Handler) http.Handler {
	observed := logging.HTTPWithErrorResponder(s.logger, InternalResponse)(next)
	tracer := s.provider.Tracer("monkeyai/web")
	return i18n.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := propagation.TraceContext{}.Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		ctx, span := tracer.Start(ctx, r.Method, trace.WithSpanKind(trace.SpanKindServer))
		defer span.End()
		observed.ServeHTTP(w, r.WithContext(ctx))
	}))
}

func Middleware(next http.Handler) http.Handler { return New(slog.Default()).Middleware(next) }
