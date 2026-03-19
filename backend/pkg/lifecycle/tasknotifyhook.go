package lifecycle

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
)

// TaskNotifyHook 任务状态变更时发送通知
type TaskNotifyHook struct {
	notify NotifyPublisher
	logger *slog.Logger
}

// NewTaskNotifyHook 创建任务通知 Hook
func NewTaskNotifyHook(i *do.Injector) *TaskNotifyHook {
	return &TaskNotifyHook{
		notify: do.MustInvoke[*dispatcher.Dispatcher](i),
		logger: do.MustInvoke[*slog.Logger](i).With("hook", "task-notify-hook"),
	}
}

func (h *TaskNotifyHook) Name() string  { return "task-notify-hook" }
func (h *TaskNotifyHook) Priority() int { return 50 }
func (h *TaskNotifyHook) Async() bool   { return true } // 异步执行，不阻塞状态转换

func (h *TaskNotifyHook) OnStateChange(ctx context.Context, taskID uuid.UUID, from, to consts.TaskStatus, metadata TaskMetadata) error {
	var eventType consts.NotifyEventType
	switch to {
	case consts.TaskStatusPending:
		eventType = consts.NotifyEventTaskCreated
	default:
		return nil
	}

	event := &domain.NotifyEvent{
		EventType:     eventType,
		SubjectUserID: metadata.UserID,
		RefID:         taskID.String(),
		Payload: domain.NotifyEventPayload{
			TaskID:     taskID.String(),
			TaskStatus: string(to),
		},
	}

	h.logger.InfoContext(ctx, "publishing notify event", "event", eventType, "task_id", taskID)
	return h.notify.Publish(ctx, event)
}
