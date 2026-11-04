package logging

import (
	"context"
	"log/slog"
	"strconv"
)

func ResponseError(ctx context.Context, code string) {
	if state, ok := ctx.Value(contextKey{}).(*observation); ok {
		state.mu.Lock()
		state.responseCode = code
		state.mu.Unlock()
	}
}
func MessageError(ctx context.Context, code, messageID string) {
	logger := slog.Default()
	if state, ok := ctx.Value(contextKey{}).(*observation); ok && state.logger != nil {
		logger = state.logger
	}
	Event(ctx, logger, slog.LevelWarn, "protocol.response.error", "协议返回错误", "code", code, "response_id", messageID)
}
func responseSummary(ctx context.Context, logger *slog.Logger, status int) {
	state, ok := ctx.Value(contextKey{}).(*observation)
	if !ok {
		return
	}
	state.mu.Lock()
	code := state.responseCode
	state.mu.Unlock()
	if code == "" && status < 400 {
		return
	}
	if code == "" {
		code = "http_" + strconv.Itoa(status)
	}
	level := slog.LevelWarn
	if status >= 500 {
		level = slog.LevelError
	}
	Event(ctx, logger, level, "http.response.error", "请求返回错误", "code", code, "status", status)
}
