package logger

import (
	"fmt"
	"log/slog"
	"os"
)

type Config struct {
	Level string
}

var level = new(slog.LevelVar)

func NewLogger(cfg *Config) *slog.Logger {
	switch cfg.Level {
	case "debug":
		level.Set(slog.LevelDebug)
	case "info":
		level.Set(slog.LevelInfo)
	case "warn":
		level.Set(slog.LevelWarn)
	case "error":
		level.Set(slog.LevelError)
	default:
		level.Set(slog.LevelWarn)
	}
	base := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:       level,
		ReplaceAttr: replaceAttr,
	})
	handler := &ContextLogger{Handler: base}
	return slog.New(handler)
}

func replaceAttr(_ []string, attr slog.Attr) slog.Attr {
	if err, ok := attr.Value.Any().(error); ok && err != nil && err.Error() == "" {
		attr.Value = slog.StringValue(fmt.Sprintf("%T", err))
	}
	return attr
}

func SetLevel(lv string) {
	switch lv {
	case "debug":
		level.Set(slog.LevelDebug)
	case "info":
		level.Set(slog.LevelInfo)
	case "warn":
		level.Set(slog.LevelWarn)
	case "error":
		level.Set(slog.LevelError)
	default:
		level.Set(slog.LevelWarn)
	}
}

func Level() string {
	return level.String()
}
