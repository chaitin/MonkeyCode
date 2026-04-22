package lifecycle

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

// VMTaskHook 将 VM 生命周期状态同步到任务生命周期。
type VMTaskHook struct {
	taskLifecycle *Manager[uuid.UUID, consts.TaskStatus, TaskMetadata]
	logger        *slog.Logger
}

func NewVMTaskHook(i *do.Injector) *VMTaskHook {
	return &VMTaskHook{
		taskLifecycle: do.MustInvoke[*Manager[uuid.UUID, consts.TaskStatus, TaskMetadata]](i),
		logger:        do.MustInvoke[*slog.Logger](i).With("hook", "vm-task-hook"),
	}
}

func (h *VMTaskHook) Name() string  { return "vm-task-hook" }
func (h *VMTaskHook) Priority() int { return 100 }
func (h *VMTaskHook) Async() bool   { return false }

func (h *VMTaskHook) OnStateChange(ctx context.Context, _ string, _ VMState, to VMState, metadata VMMetadata) error {
	if metadata.TaskID == nil {
		return nil
	}

	var target consts.TaskStatus
	switch to {
	case VMStateRunning:
		target = consts.TaskStatusProcessing
	case VMStateFailed:
		target = consts.TaskStatusError
	case VMStateRecycled:
		target = consts.TaskStatusFinished
	default:
		return nil
	}

	h.logger.InfoContext(ctx, "sync task lifecycle from vm lifecycle", "task_id", metadata.TaskID, "state", target)
	return h.taskLifecycle.Transition(ctx, *metadata.TaskID, target, TaskMetadata{
		TaskID: *metadata.TaskID,
		UserID: metadata.UserID,
	})
}
