package worker

import (
	"context"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/preflight"
)

func (w *Worker) Report(ctx context.Context, cfg control.Config) (preflight.Report, error) {
	if reporter, ok := w.executor.(interface {
		Report(context.Context, control.Config) (preflight.Report, error)
	}); ok {
		return reporter.Report(ctx, cfg)
	}
	return preflight.Report{}, errors.New("当前执行器不支持Firecracker能力上报")
}

func (w *Worker) Guard(ctx context.Context, cfg control.Config) error {
	if guard, ok := w.executor.(interface {
		Guard(context.Context, control.Config) error
	}); ok {
		return guard.Guard(ctx, cfg)
	}
	return nil
}
