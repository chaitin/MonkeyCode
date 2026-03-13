package logger

import (
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
		Level: level,
	})
	handler := &ContextLogger{Handler: base}
	return slog.New(handler)
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
