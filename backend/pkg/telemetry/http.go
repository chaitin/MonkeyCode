package telemetry

import (
	"context"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

func SanitizeIncomingTrace(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		header := c.Request().Header
		header.Del("baggage")
		if !strings.HasPrefix(c.Request().URL.Path, "/internal/") {
			header.Del("traceparent")
			header.Del("tracestate")
		}
		return next(c)
	}
}

func TraceHeader(ctx context.Context) http.Header {
	header := make(http.Header)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(header))
	return header
}
