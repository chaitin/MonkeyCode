package proxy

import (
	"context"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func (p *Proxy) logCall(ctx context.Context, pc *proxyContext, call Call, cause error, diagnostic ...slog.Attr) {
	pc.logged.Do(func() {
		result := call.Result
		if result == "" {
			result = "succeeded"
		}
		if result == "failed" && call.ErrorCode == "" {
			call.ErrorCode = "upstream_failed"
		}
		level := slog.LevelDebug
		if result == "failed" {
			level = slog.LevelError
			if pc.upstreamStatus >= 400 && pc.upstreamStatus < 500 {
				level = slog.LevelWarn
			}
		}
		if ctx.Err() != nil && result == "failed" && (call.ErrorCode == "stream_interrupted" || call.ErrorCode == "upstream_connection_failed") {
			result, level = "canceled", slog.LevelDebug
		}
		logging.CountCall(p.logger, result)
		attrs := []slog.Attr{slog.String("module", "proxy"), slog.String("operation", "proxy_request"),
			slog.String("model_id", pc.target.ModelID), slog.String("transaction_id", pc.reservation.ID),
			slog.String("response_id", call.RequestID), slog.String("result", result), slog.Bool("stream", pc.stream),
			slog.Bool("usage_known", call.Known), slog.String("error_code", call.ErrorCode), slog.String("terminal_event", call.TerminalEvent)}
		if !pc.startedAt.IsZero() {
			attrs = append(attrs, slog.Int64("duration_ms", time.Since(pc.startedAt).Milliseconds()))
		}
		if pc.upstreamStatus != 0 {
			attrs = append(attrs, slog.Int("upstream_status", pc.upstreamStatus))
		}
		if pc.upstreamRequestID != "" {
			attrs = append(attrs, slog.String("upstream_request_id", pc.upstreamRequestID))
		}
		attrs = append(attrs, diagnostic...)
		if result == "failed" {
			logging.OwnDiagnostic(ctx)
			attrs = append(attrs, logging.ErrorAttrs(cause)...)
			args := make([]any, len(attrs))
			for i := range attrs {
				args[i] = attrs[i]
			}
			logging.Event(ctx, p.logger, level, "model.call.completed", "模型调用完成", args...)
		} else {
			attrs = append(attrs, slog.String("event", "model.call.completed"))
			p.logger.LogAttrs(ctx, level, "模型调用完成", attrs...)
		}
	})
}
