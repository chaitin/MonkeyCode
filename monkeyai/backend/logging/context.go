package logging

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"runtime"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

type contextKey struct{}

type observation struct {
	mu                           sync.Mutex
	id                           string
	fields                       map[string]slog.Attr
	diagnosed, expected, aborted bool
	finished                     bool
}

func newObservation() *observation {
	var id [16]byte
	// crypto/rand.Read terminates the process if the system RNG fails.
	_, _ = rand.Read(id[:])
	return &observation{id: hex.EncodeToString(id[:]), fields: make(map[string]slog.Attr)}
}

func RequestID(ctx context.Context) string {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		return state.id
	}
	return ""
}

// Bind adds safe association fields to the current request, including work that
// continues with context.WithoutCancel. It never retains request or body data.
func Bind(ctx context.Context, attrs ...slog.Attr) {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		defer state.mu.Unlock()
		for _, a := range attrs {
			if a.Key == "request_id" {
				continue
			}
			if a = safeAttr(a); !a.Equal(slog.Attr{}) {
				state.fields[a.Key] = a
			}
		}
	}
}

func ContextField(ctx context.Context, key string) (slog.Attr, bool) {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		defer state.mu.Unlock()
		a, found := state.fields[key]
		return a, found
	}
	return slog.Attr{}, false
}

func Expected(ctx context.Context) {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		state.expected = true
		state.mu.Unlock()
	}
}

func IsExpected(ctx context.Context) bool {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		defer state.mu.Unlock()
		return state.expected
	}
	return false
}

func OwnDiagnostic(ctx context.Context) {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		state.diagnosed = true
		state.mu.Unlock()
	}
}

func Diagnosed(ctx context.Context) bool {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		defer state.mu.Unlock()
		return state.diagnosed
	}
	return false
}

// Event keeps existing fixed messages while normalizing attributes even for
// caller-supplied handlers that do not use the shared safety layer.
func Event(ctx context.Context, logger *slog.Logger, level slog.Level, event, message string, args ...any) {
	if ctx == nil {
		ctx = context.Background()
	}
	if event == "identity.request.failed" || event == "apikey.request.failed" || event == "mcp.request.failed" {
		OwnDiagnostic(ctx)
	}
	if !logger.Enabled(ctx, level) {
		return
	}
	record := slog.NewRecord(time.Now(), level, message, 0)
	record.Add(args...)
	attrs := []slog.Attr{slog.String("event", event)}
	record.Attrs(func(a slog.Attr) bool {
		if a = safeAttr(a); !a.Equal(slog.Attr{}) {
			attrs = append(attrs, a)
		}
		return true
	})
	var pc [1]uintptr
	runtime.Callers(2, pc[:])
	clean := slog.NewRecord(record.Time, level, message, pc[0])
	clean.AddAttrs(mergeAttrs(attrs)...)
	_ = logger.Handler().Handle(ctx, clean)
}

// Diagnostic records ownership before level filtering or deduplication. This
// prevents HTTP fallback errors from bypassing the primary event's policy.
func syncRoute(ctx context.Context) {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		defer state.mu.Unlock()
		if !state.finished {
			if rc := chi.RouteContext(ctx); rc != nil && rc.RoutePattern() != "" {
				state.fields["route"] = safeAttr(slog.String("route", rc.RoutePattern()))
			}
		}
	}
}

func Diagnostic(ctx context.Context, logger *slog.Logger, level slog.Level, event string, err error, attrs ...slog.Attr) {
	syncRoute(ctx)
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		state.diagnosed = true
		state.mu.Unlock()
	}
	attrs = append(attrs, slog.String("event", event))
	attrs = append(attrs, ErrorAttrs(err)...)
	if !logger.Enabled(ctx, level) {
		return
	}
	var pc [1]uintptr
	runtime.Callers(2, pc[:])
	record := slog.NewRecord(time.Now(), level, "操作诊断", pc[0])
	clean := make([]slog.Attr, 0, len(attrs))
	for _, a := range attrs {
		if a = safeAttr(a); !a.Equal(slog.Attr{}) {
			clean = append(clean, a)
		}
	}
	record.AddAttrs(mergeAttrs(clean)...)
	_ = logger.Handler().Handle(ctx, record)
}

func contextAttrs(ctx context.Context) []slog.Attr {
	state, ok := ctx.Value(contextKey{}).(*observation)
	if !ok {
		return nil
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	attrs := make([]slog.Attr, 0, len(state.fields)+1)
	for _, a := range state.fields {
		attrs = append(attrs, a)
	}
	return append(attrs, slog.String("request_id", state.id))
}
