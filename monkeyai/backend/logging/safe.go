package logging

import (
	"log/slog"
	"strings"
)

var stringFields = map[string]bool{
	"event": true, "module": true, "operation": true, "phase": true,
	"error_code": true, "error_type": true, "reason": true, "sqlstate": true,
	"request_id": true, "response_id": true, "upstream_request_id": true,
	"session_id": true, "user_id": true, "model_id": true, "connector_id": true,
	"job_id": true, "transaction_id": true, "machine_id": true, "server_id": true,
	"boot_id": true, "connection_id": true, "upload_id": true, "import_id": true,
	"worker_run_id": true, "channel_kind": true, "dependency": true,
	"result": true, "transport_result": true, "terminal_event": true, "method": true,
	"previous_level": true, "current_level": true, "origin": true,
	"intent": true, "code": true, "kind": true, "status": true, "provider": true,
	"usage_error_code": true, "file": true, "resource_id": true, "key_id": true,
	"original_event": true, "original_level": true, "fingerprint": true, "flush_reason": true,
	"input_source": true, "output_source": true,
}

func sensitive(key string) bool {
	key = strings.ToLower(key)
	for _, part := range []string{"password", "secret", "token", "authorization", "cookie", "credential", "payload", "header", "filename"} {
		if strings.Contains(key, part) {
			return true
		}
	}
	switch key {
	case "key", "path", "url", "endpoint", "body", "query", "args", "config", "dsn", "message", "error_message", "panic", "source", "time", "level", "msg":
		return true
	}
	return false
}

func safeAttr(a slog.Attr) slog.Attr {
	if sensitive(a.Key) {
		return slog.Attr{}
	}
	switch a.Value.Kind() {
	case slog.KindLogValuer:
		// JSONHandler resolves LogValuer before ReplaceAttr, so filter here.
		return slog.Attr{}
	case slog.KindAny:
		if err, ok := a.Value.Any().(error); ok && err != nil {
			attrs := ErrorAttrs(err)
			return slog.Attr{Key: a.Key, Value: slog.GroupValue(attrs...)}
		}
		return slog.Attr{}
	case slog.KindGroup:
		attrs := make([]slog.Attr, 0, len(a.Value.Group()))
		for _, child := range a.Value.Group() {
			if child = safeAttr(child); !child.Equal(slog.Attr{}) {
				attrs = append(attrs, child)
			}
		}
		if len(attrs) == 0 {
			return slog.Attr{}
		}
		return slog.Attr{Key: a.Key, Value: slog.GroupValue(attrs...)}
	case slog.KindString:
		value := a.Value.String()
		if value == "" {
			return slog.Attr{}
		}
		if a.Key == "function" {
			if len(value) > 256 {
				return slog.Attr{}
			}
			for _, r := range value {
				if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_./*()[]:-", r)) {
					return slog.Attr{}
				}
			}
			return a
		}
		if a.Key == "route" {
			if len(value) <= 256 && !strings.ContainsAny(value, "?\r\n") &&
				(strings.ContainsAny(value, "{*") || value == "unmatched" || value == "/acp" || value == "/healthz" || value == "/readyz") {
				return a
			}
			return slog.String(a.Key, "unmatched")
		}
		if !stringFields[a.Key] || len(value) > 128 {
			return slog.Attr{}
		}
		for _, r := range value {
			if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_.:-*+[]", r)) {
				return slog.Attr{}
			}
		}
	}
	return a
}
