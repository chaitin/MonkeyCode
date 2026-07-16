package telemetry

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type contextKey string

const (
	taskIDKey         contextKey = "monkeycode.task.id"
	agentSessionIDKey contextKey = "monkeycode.agent.session.id"
	businessReqIDKey  contextKey = "monkeycode.request.id"
	projectIDKey      contextKey = "monkeycode.project.id"
	vmIDKey           contextKey = "taskflow.vm.id"
	terminalIDKey     contextKey = "taskflow.terminal.session.id"
)

func WithTaskID(ctx context.Context, id string) context.Context {
	return withID(ctx, taskIDKey, "monkeycode.task.id", id)
}

func WithAgentSessionID(ctx context.Context, id string) context.Context {
	return withID(ctx, agentSessionIDKey, "monkeycode.agent.session.id", id)
}

func WithRequestID(ctx context.Context, id string) context.Context {
	return withID(ctx, businessReqIDKey, "monkeycode.request.id", id)
}

func WithProjectID(ctx context.Context, id string) context.Context {
	return withID(ctx, projectIDKey, "monkeycode.project.id", id)
}

func WithVMID(ctx context.Context, id string) context.Context {
	return withID(ctx, vmIDKey, "taskflow.vm.id", id)
}

func WithTerminalSessionID(ctx context.Context, id string) context.Context {
	return withID(ctx, terminalIDKey, "taskflow.terminal.session.id", id)
}

func MarkCritical(ctx context.Context) {
	trace.SpanFromContext(ctx).SetAttributes(attribute.String("telemetry.priority", "critical"))
}

func SetOutcome(ctx context.Context, outcome string) {
	if outcome != "" {
		trace.SpanFromContext(ctx).SetAttributes(attribute.String("task.outcome", outcome))
	}
}

func withID(ctx context.Context, key contextKey, name, id string) context.Context {
	if id == "" {
		return ctx
	}
	trace.SpanFromContext(ctx).SetAttributes(attribute.String(name, id))
	return context.WithValue(ctx, key, id)
}

func LogAttrs(ctx context.Context) []slog.Attr {
	attrs := make([]slog.Attr, 0, 8)
	spanContext := trace.SpanContextFromContext(ctx)
	if spanContext.IsValid() {
		attrs = append(attrs,
			slog.String("trace_id", spanContext.TraceID().String()),
			slog.String("span_id", spanContext.SpanID().String()),
		)
	}
	for _, item := range []struct {
		key  contextKey
		name string
	}{
		{taskIDKey, "monkeycode.task.id"},
		{agentSessionIDKey, "monkeycode.agent.session.id"},
		{businessReqIDKey, "monkeycode.request.id"},
		{projectIDKey, "monkeycode.project.id"},
		{vmIDKey, "taskflow.vm.id"},
		{terminalIDKey, "taskflow.terminal.session.id"},
	} {
		if value, ok := ctx.Value(item.key).(string); ok && value != "" {
			attrs = append(attrs, slog.String(item.name, value))
		}
	}
	return attrs
}
