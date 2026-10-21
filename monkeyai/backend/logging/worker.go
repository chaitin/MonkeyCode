package logging

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Worker tracks only a dependency that its owning loop actually checks. Task
// retry results remain separate events scoped to the task or transaction.
type Worker struct {
	mu                            sync.Mutex
	logger                        *slog.Logger
	module, operation, dependency string
	first                         time.Time
	failures                      uint64
}

func NewWorker(logger *slog.Logger, module, operation, dependency string) *Worker {
	return &Worker{logger: logger, module: module, operation: operation, dependency: dependency}
}

func (w *Worker) Report(ctx context.Context, err error) {
	if ctx.Err() != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
		return
	}
	w.mu.Lock()
	if err != nil {
		if w.first.IsZero() {
			w.first = time.Now()
		}
		w.failures++
	} else if w.first.IsZero() {
		w.mu.Unlock()
		return
	}
	first, count := w.first, w.failures
	if err == nil {
		w.first = time.Time{}
		w.failures = 0
	}
	w.mu.Unlock()
	fields := []slog.Attr{slog.String("module", w.module), slog.String("operation", w.operation), slog.String("dependency", w.dependency)}
	if err != nil {
		fields = append(fields, ErrorAttrs(err)...)
		fields = append(fields, slog.String("event", "worker.scan.failed"), slog.String("worker_run_id", newObservation().id))
		w.logger.LogAttrs(ctx, slog.LevelWarn, "后台依赖检查失败", fields...)
		return
	}
	if r := runtimeFor(w.logger); r != nil {
		r.Recovered(ctx, "worker.scan.failed", fields...)
	}
	fields = append(fields, slog.String("event", "dependency.recovered"), slog.Uint64("failure_count", count), slog.Int64("duration_ms", time.Since(first).Milliseconds()))
	w.logger.LogAttrs(ctx, slog.LevelInfo, "后台依赖已恢复", fields...)
}
