// Package logging constructs the shared structured logging pipeline.
package logging

import (
	"context"
	"io"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

func jsonHandler(output io.Writer, level slog.Leveler) slog.Handler {
	return slog.NewJSONHandler(output, &slog.HandlerOptions{Level: level, AddSource: true,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			if a.Key == slog.SourceKey {
				if source, ok := a.Value.Any().(*slog.Source); ok {
					copy := *source
					copy.File = filepath.Base(copy.File)
					return slog.Any(a.Key, &copy)
				}
			}
			return a
		}})
}

// New constructs an unbuffered logger without a background worker.
func New(output io.Writer, level slog.Leveler) *slog.Logger {
	return slog.New(&safeHandler{next: jsonHandler(output, level)})
}

type safeHandler struct {
	next    slog.Handler
	runtime *Runtime
	attrs   []slog.Attr
	groups  []string
}

func (h *safeHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func grouped(groups []string, a slog.Attr) slog.Attr {
	for i := len(groups) - 1; i >= 0; i-- {
		a = slog.Attr{Key: groups[i], Value: slog.GroupValue(a)}
	}
	return a
}

func mergeAttrs(attrs []slog.Attr) []slog.Attr {
	out := make([]slog.Attr, 0, len(attrs))
	index := make(map[string]int)
	for _, a := range attrs {
		if a.Equal(slog.Attr{}) {
			continue
		}
		if a.Value.Kind() == slog.KindGroup {
			children := a.Value.Group()
			if a.Key == "" {
				for _, child := range mergeAttrs(children) {
					out = append(out, child)
				}
				continue
			}
			if i, ok := index[a.Key]; ok && out[i].Value.Kind() == slog.KindGroup {
				children = append(append([]slog.Attr(nil), out[i].Value.Group()...), children...)
			}
			a.Value = slog.GroupValue(mergeAttrs(children)...)
		}
		if i, ok := index[a.Key]; ok {
			out[i] = a
		} else {
			index[a.Key] = len(out)
			out = append(out, a)
		}
	}
	return out
}

func (h *safeHandler) Handle(ctx context.Context, record slog.Record) error {
	attrs := append([]slog.Attr(nil), h.attrs...)
	record.Attrs(func(a slog.Attr) bool {
		if a = safeAttr(a); !a.Equal(slog.Attr{}) {
			attrs = append(attrs, grouped(h.groups, a))
		}
		return true
	})
	attrs = append(attrs, contextAttrs(ctx)...)
	clean := slog.NewRecord(record.Time, record.Level, record.Message, record.PC)
	clean.AddAttrs(mergeAttrs(attrs)...)
	if h.runtime != nil {
		return h.runtime.submit(ctx, clean)
	}
	return h.next.Handle(ctx, clean)
}

func (h *safeHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	copy := *h
	copy.attrs = append([]slog.Attr(nil), h.attrs...)
	for _, a := range attrs {
		if a = safeAttr(a); !a.Equal(slog.Attr{}) {
			copy.attrs = append(copy.attrs, grouped(h.groups, a))
		}
	}
	return &copy
}
func (h *safeHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	copy := *h
	copy.groups = append(append([]string(nil), h.groups...), name)
	return &copy
}

// LevelChanged bypasses only the business threshold for this fixed event.
func LevelChanged(ctx context.Context, logger *slog.Logger, previous, current slog.Level) error {
	var pcs [1]uintptr
	runtime.Callers(2, pcs[:])
	record := slog.NewRecord(time.Now(), slog.LevelInfo, "日志级别已修改", pcs[0])
	record.AddAttrs(slog.String("event", "logging.level.changed"), slog.String("previous_level", previous.String()),
		slog.String("current_level", current.String()), slog.Int("pid", os.Getpid()), slog.String("origin", "local_cli"))
	return logger.Handler().Handle(ctx, record)
}

func ErrorLog(logger *slog.Logger) *log.Logger { return log.New(runtimeWriter{logger}, "", 0) }

type runtimeWriter struct{ logger *slog.Logger }

func (w runtimeWriter) Write(p []byte) (int, error) {
	w.logger.Error("HTTP 运行时错误", "event", "runtime.http.error")
	return len(p), nil
}

func runtimeFor(logger *slog.Logger) *Runtime {
	if h, ok := logger.Handler().(*safeHandler); ok {
		return h.runtime
	}
	return nil
}
