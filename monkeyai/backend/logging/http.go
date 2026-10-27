package logging

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"time"

	"github.com/go-chi/chi/v5"
)

// HTTP observes the whole application before preview and authentication guards.
func HTTP(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			state := newObservation()
			ctx := context.WithValue(r.Context(), contextKey{}, state)
			Bind(ctx, slog.String("method", r.Method))
			r = r.WithContext(ctx)
			started := time.Now()
			writer := &responseWriter{ResponseWriter: w, id: state.id}
			w.Header().Set("X-Request-ID", state.id)
			defer func() {
				fault := recover()
				abort := fault == http.ErrAbortHandler
				if fault != nil {
					writer.aborted = true
					if !abort {
						var pcs [24]uintptr
						n := runtime.Callers(3, pcs[:])
						frames := runtime.CallersFrames(pcs[:n])
						var stack []slog.Attr
						for i := 0; ; i++ {
							frame, more := frames.Next()
							stack = append(stack, slog.Group(fmt.Sprintf("frame%d", i), "file", filepath.Base(frame.File), "function", frame.Function, "line", frame.Line))
							if !more {
								break
							}
						}
						Diagnostic(ctx, logger, slog.LevelError, "http.request.panicked", nil,
							slog.String("error_type", fmt.Sprintf("%T", fault)), slog.String("error_message", fmt.Sprint(fault)), slog.Attr{Key: "stack", Value: slog.GroupValue(stack...)})
						if writer.status == 0 && !writer.hijacked {
							writer.Header().Set("Content-Type", "application/json; charset=utf-8")
							writer.WriteHeader(http.StatusInternalServerError)
							if _, err := io.WriteString(writer, "{\"error\":{\"code\":\"internal_error\",\"message\":\"服务内部错误\"}}\n"); err != nil {
								Diagnostic(ctx, logger, slog.LevelError, "http.response.failed", err)
							}
						} else {
							abort = true
						}
					}
				}
				route := "unmatched"
				if bound, ok := ContextField(ctx, "route"); ok {
					route = bound.Value.String()
				}
				if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePattern() != "" {
					route = rc.RoutePattern()
				}
				Bind(ctx, slog.String("route", route), slog.String("method", r.Method))
				state.mu.Lock()
				state.finished = true
				diagnosed, expected := state.diagnosed, state.expected
				state.mu.Unlock()
				failed := writer.status >= 500 || writer.aborted || r.Context().Err() != nil
				result := "completed"
				if writer.hijacked {
					result = "upgraded"
				}
				if writer.aborted {
					result = "aborted"
				}
				if r.Context().Err() != nil {
					result = "canceled"
				}
				attrs := []slog.Attr{slog.String("event", "http.request.completed"), slog.String("transport_result", result), slog.Int64("duration_ms", time.Since(started).Milliseconds())}
				if writer.status != 0 {
					attrs = append(attrs, slog.Int("status", writer.status))
				}
				if failed && !diagnosed && !expected && r.Context().Err() == nil {
					Diagnostic(ctx, logger, slog.LevelError, "http.request.failed", nil, attrs[1:]...)
				} else if route != "/healthz" && route != "/readyz" {
					logger.LogAttrs(ctx, slog.LevelDebug, "HTTP 请求完成", attrs...)
				}
				if abort {
					panic(http.ErrAbortHandler)
				}
			}()
			next.ServeHTTP(capabilities(writer), r)
		})
	}
}

type responseWriter struct {
	http.ResponseWriter
	id                string
	status            int
	aborted, hijacked bool
}

func (w *responseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *responseWriter) WriteHeader(code int) {
	w.Header().Set("X-Request-ID", w.id)
	if code >= 200 || code == http.StatusSwitchingProtocols {
		if w.status != 0 {
			return
		}
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}
func (w *responseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(data)
	if err != nil {
		w.aborted = true
	}
	return n, err
}

type flushCapability struct{ w *responseWriter }

func (c flushCapability) Flush() {
	if c.w.status == 0 {
		c.w.WriteHeader(http.StatusOK)
	}
	c.w.ResponseWriter.(http.Flusher).Flush()
}

type hijackCapability struct{ w *responseWriter }

func (c hijackCapability) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, rw, err := c.w.ResponseWriter.(http.Hijacker).Hijack()
	if err == nil {
		c.w.hijacked = true
	}
	return conn, rw, err
}

type pushCapability struct{ w *responseWriter }

func (c pushCapability) Push(target string, opts *http.PushOptions) error {
	return c.w.ResponseWriter.(http.Pusher).Push(target, opts)
}

type readCapability struct{ w *responseWriter }

func (c readCapability) ReadFrom(src io.Reader) (int64, error) {
	if c.w.status == 0 {
		c.w.WriteHeader(http.StatusOK)
	}
	n, err := c.w.ResponseWriter.(io.ReaderFrom).ReadFrom(src)
	if err != nil {
		c.w.aborted = true
	}
	return n, err
}

// Exact method sets preserve even uncommon ResponseWriter combinations.
func capabilities(w *responseWriter) http.ResponseWriter {
	mask := 0
	if _, ok := w.ResponseWriter.(http.Flusher); ok {
		mask |= 1
	}
	if _, ok := w.ResponseWriter.(http.Hijacker); ok {
		mask |= 2
	}
	if _, ok := w.ResponseWriter.(http.Pusher); ok {
		mask |= 4
	}
	if _, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		mask |= 8
	}
	f, h, p, r := flushCapability{w}, hijackCapability{w}, pushCapability{w}, readCapability{w}
	switch mask {
	case 1:
		return struct {
			*responseWriter
			http.Flusher
		}{w, f}
	case 2:
		return struct {
			*responseWriter
			http.Hijacker
		}{w, h}
	case 3:
		return struct {
			*responseWriter
			http.Flusher
			http.Hijacker
		}{w, f, h}
	case 4:
		return struct {
			*responseWriter
			http.Pusher
		}{w, p}
	case 5:
		return struct {
			*responseWriter
			http.Flusher
			http.Pusher
		}{w, f, p}
	case 6:
		return struct {
			*responseWriter
			http.Hijacker
			http.Pusher
		}{w, h, p}
	case 7:
		return struct {
			*responseWriter
			http.Flusher
			http.Hijacker
			http.Pusher
		}{w, f, h, p}
	case 8:
		return struct {
			*responseWriter
			io.ReaderFrom
		}{w, r}
	case 9:
		return struct {
			*responseWriter
			http.Flusher
			io.ReaderFrom
		}{w, f, r}
	case 10:
		return struct {
			*responseWriter
			http.Hijacker
			io.ReaderFrom
		}{w, h, r}
	case 11:
		return struct {
			*responseWriter
			http.Flusher
			http.Hijacker
			io.ReaderFrom
		}{w, f, h, r}
	case 12:
		return struct {
			*responseWriter
			http.Pusher
			io.ReaderFrom
		}{w, p, r}
	case 13:
		return struct {
			*responseWriter
			http.Flusher
			http.Pusher
			io.ReaderFrom
		}{w, f, p, r}
	case 14:
		return struct {
			*responseWriter
			http.Hijacker
			http.Pusher
			io.ReaderFrom
		}{w, h, p, r}
	case 15:
		return struct {
			*responseWriter
			http.Flusher
			http.Hijacker
			http.Pusher
			io.ReaderFrom
		}{w, f, h, p, r}
	default:
		return w
	}
}
