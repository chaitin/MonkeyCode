package logging

import (
	"encoding/json"
	"log/slog"
	"time"
)

type policy struct {
	scope  []string
	sample string
	window time.Duration
}

var policies = map[string]policy{
	"model.call.completed":             {scope: []string{"model_id", "operation"}, sample: "request_id"},
	"model.usage.failed":               {scope: []string{"model_id"}, sample: "request_id"},
	"http.request.failed":              {scope: []string{"route", "method"}, sample: "request_id"},
	"resource.operation.failed":        {scope: []string{"route", "method"}, sample: "request_id"},
	"readiness.failed":                 {scope: []string{"dependency"}, sample: "request_id"},
	"relay.stream.failed":              {scope: []string{"server_id", "user_id", "machine_id", "operation", "phase"}, sample: "connection_id"},
	"resource.upload.operation.failed": {scope: []string{"upload_id", "phase"}, sample: "request_id"},
	"mcp.credential.retry":             {scope: []string{"connector_id", "operation"}, sample: "worker_run_id", window: 5 * time.Minute},
	"resource.upload.failed":           {scope: []string{"upload_id", "chunk_index", "phase"}, sample: "request_id"},
	"billing.retry.failed":             {scope: []string{"transaction_id", "operation"}, sample: "transaction_id", window: 5 * time.Minute},
	"image.job.retry":                  {scope: []string{"job_id", "operation"}, sample: "job_id", window: 5 * time.Minute},
	"video.job.retry":                  {scope: []string{"job_id", "operation"}, sample: "job_id", window: 5 * time.Minute},
	"worker.scan.failed":               {scope: []string{"module", "operation", "dependency"}, sample: "worker_run_id", window: 5 * time.Minute},
}

func scalars(record slog.Record) map[string]slog.Attr {
	result := make(map[string]slog.Attr)
	var add func(slog.Attr)
	add = func(a slog.Attr) {
		if a.Value.Kind() == slog.KindGroup {
			for _, child := range a.Value.Group() {
				add(child)
			}
			return
		}
		if a.Value.Kind() != slog.KindAny && a.Value.Kind() != slog.KindLogValuer {
			result[a.Key] = a
		}
	}
	record.Attrs(func(a slog.Attr) bool { add(a); return true })
	return result
}

func fingerprint(level slog.Level, fields map[string]slog.Attr, p policy) (string, []slog.Attr) {
	if level < slog.LevelWarn {
		return "", nil
	}
	keys := []string{"event", "module", "operation", "error_code", "error_type", "upstream_status", "sqlstate"}
	for _, key := range p.scope {
		if a, ok := fields[key]; !ok || a.Value.String() == "" {
			return "", nil
		}
	}
	keys = append(keys, p.scope...)
	seen := make(map[string]bool)
	tuple := []any{level.String()}
	var attrs []slog.Attr
	for _, key := range keys {
		if seen[key] {
			continue
		}
		seen[key] = true
		if a, ok := fields[key]; ok {
			tuple = append(tuple, key, a.Value.String())
			if key != "event" {
				attrs = append(attrs, a)
			}
		}
	}
	data, _ := json.Marshal(tuple)
	return string(data), attrs
}
