package logger

import (
	"context"
	"log/slog"
)

type contextKey string

const (
	RequestIDKey contextKey = "request_id"
	UserIDKey    contextKey = "user_id"
)

type ContextLogger struct {
	slog.Handler
}

func (c *ContextLogger) Enabled(ctx context.Context, level slog.Level) bool {
	return c.Handler.Enabled(ctx, level)
}

func (c *ContextLogger) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextLogger{Handler: c.Handler.WithAttrs(attrs)}
}

func (c *ContextLogger) WithGroup(name string) slog.Handler {
	return &ContextLogger{Handler: c.Handler.WithGroup(name)}
}

func (c *ContextLogger) Handle(ctx context.Context, r slog.Record) error {
	newRecord := r.Clone()

	if i, ok := ctx.Value(RequestIDKey).(string); ok {
		newRecord.AddAttrs(slog.String("request_id", i))
	}

	if i, ok := ctx.Value(UserIDKey).(string); ok {
		newRecord.AddAttrs(slog.String("user_id", i))
	}

	return c.Handler.Handle(ctx, newRecord)
}
