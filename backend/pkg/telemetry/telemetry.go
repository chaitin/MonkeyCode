package telemetry

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type Config struct {
	Enabled        bool   `mapstructure:"enabled"`
	Endpoint       string `mapstructure:"endpoint"`
	Insecure       bool   `mapstructure:"insecure"`
	ServiceName    string `mapstructure:"service_name"`
	ServiceVersion string `mapstructure:"service_version"`
	Environment    string `mapstructure:"environment"`
}

type Shutdown func(context.Context) error

func Setup(ctx context.Context, cfg Config) (Shutdown, error) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	if !enabled(cfg) {
		return func(context.Context) error { return nil }, nil
	}

	opts := []otlptracegrpc.Option{}
	if endpoint := strings.TrimSpace(cfg.Endpoint); endpoint != "" {
		if strings.Contains(endpoint, "://") {
			opts = append(opts, otlptracegrpc.WithEndpointURL(endpoint))
		} else {
			opts = append(opts, otlptracegrpc.WithEndpoint(endpoint))
		}
	}
	if cfg.Insecure {
		opts = append(opts, otlptracegrpc.WithInsecure())
	}

	exporter, err := otlptracegrpc.New(ctx, opts...)
	if err != nil {
		return nil, err
	}
	tp, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider)
	if !ok {
		_ = exporter.Shutdown(ctx)
		return nil, errors.New("全局 tracer provider 不是 SDK provider")
	}

	processor := sdktrace.NewBatchSpanProcessor(
		&resourceExporter{SpanExporter: exporter, resource: buildResource(cfg)},
		sdktrace.WithMaxQueueSize(2048),
		sdktrace.WithMaxExportBatchSize(512),
		sdktrace.WithBatchTimeout(5*time.Second),
		sdktrace.WithExportTimeout(5*time.Second),
	)
	tp.RegisterSpanProcessor(processor)
	return processor.Shutdown, nil
}

func enabled(cfg Config) bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("OTEL_SDK_DISABLED")), "true") || !cfg.Enabled {
		return false
	}
	if strings.TrimSpace(cfg.Endpoint) != "" {
		return true
	}
	return strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")) != "" ||
		strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")) != ""
}

func buildResource(cfg Config) *resource.Resource {
	attrs := []attribute.KeyValue{attribute.String("service.name", cfg.ServiceName)}
	if cfg.ServiceVersion != "" {
		attrs = append(attrs, attribute.String("service.version", cfg.ServiceVersion))
	}
	if cfg.Environment != "" {
		attrs = append(attrs, attribute.String("deployment.environment.name", cfg.Environment))
	}
	return resource.NewSchemaless(attrs...)
}

type resourceExporter struct {
	sdktrace.SpanExporter
	resource *resource.Resource
}

func (e *resourceExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	wrapped := make([]sdktrace.ReadOnlySpan, len(spans))
	for i, span := range spans {
		wrapped[i] = resourceSpan{
			ReadOnlySpan: span,
			resource:     e.resource,
			attributes:   sanitizeAttributes(span.Attributes()),
			events:       sanitizeEvents(span.Events()),
			links:        sanitizeLinks(span.Links()),
			status:       sanitizeStatus(span.Status()),
		}
	}
	return e.SpanExporter.ExportSpans(ctx, wrapped)
}

type resourceSpan struct {
	sdktrace.ReadOnlySpan
	resource   *resource.Resource
	attributes []attribute.KeyValue
	events     []sdktrace.Event
	links      []sdktrace.Link
	status     sdktrace.Status
}

func (s resourceSpan) Resource() *resource.Resource {
	return s.resource
}

func (s resourceSpan) Attributes() []attribute.KeyValue {
	return s.attributes
}

func (s resourceSpan) Events() []sdktrace.Event {
	return s.events
}

func (s resourceSpan) Links() []sdktrace.Link {
	return s.links
}

func (s resourceSpan) Status() sdktrace.Status {
	return s.status
}
