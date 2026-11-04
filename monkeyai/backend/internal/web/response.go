package web

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web/internal/i18n"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"go.opentelemetry.io/otel/trace"
)

func Message(ctx context.Context, code, source string) string {
	logging.ResponseError(ctx, code)
	return withTrace(ctx, i18n.Text(ctx, code, source))
}
func withTrace(ctx context.Context, message string) string {
	span := trace.SpanContextFromContext(ctx)
	if !span.IsValid() {
		return message
	}
	suffix := " [trace_id: " + span.TraceID().String() + "]"
	if strings.HasSuffix(message, suffix) {
		return message
	}
	return message + suffix
}
func Body(ctx context.Context, code, message string) map[string]any {
	return map[string]any{"code": code, "message": Message(ctx, code, message)}
}
func Notice(ctx context.Context, code string) string { return i18n.Text(ctx, code, "") }
func Locale(ctx context.Context) string              { return i18n.Locale(ctx) }

// FrameMessage 按消息记录，不使用连接级去重。
func FrameMessage(ctx context.Context, code, message, messageID string) string {
	logging.MessageError(ctx, code, messageID)
	return withTrace(ctx, i18n.Text(ctx, code, message))
}
func HTTPError(w http.ResponseWriter, r *http.Request, status int) {
	http.Error(w, Message(r.Context(), "http_"+strconv.Itoa(status), http.StatusText(status)), status)
}
func NotFound(w http.ResponseWriter, r *http.Request)         { HTTPError(w, r, 404) }
func MethodNotAllowed(w http.ResponseWriter, r *http.Request) { HTTPError(w, r, 405) }
func InternalResponse(ctx context.Context, w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(500)
	return json.NewEncoder(w).Encode(map[string]any{"error": Body(ctx, "internal_error", "服务内部错误")})
}
func JSON(ctx context.Context, w http.ResponseWriter, status int, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		logging.Diagnostic(ctx, slog.Default(), slog.LevelError, "http.response.failed", err)
		if err := InternalResponse(ctx, w); err != nil {
			logging.Diagnostic(ctx, slog.Default(), slog.LevelWarn, "http.response.failed", err)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if _, err := w.Write(append(data, '\n')); err != nil && ctx.Err() == nil {
		logging.Diagnostic(ctx, slog.Default(), slog.LevelWarn, "http.response.failed", err)
	}
}
