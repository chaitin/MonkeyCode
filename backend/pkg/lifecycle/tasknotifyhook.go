package lifecycle

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
)

// TaskNotifyHook 任务状态变更时发送通知
type TaskNotifyHook struct {
	notify *dispatcher.Dispatcher
	logger *slog.Logger
	repo   domain.TaskRepo
}

// NewTaskNotifyHook 创建任务通知 Hook
func NewTaskNotifyHook(i *do.Injector) *TaskNotifyHook {
	return &TaskNotifyHook{
		notify: do.MustInvoke[*dispatcher.Dispatcher](i),
		logger: do.MustInvoke[*slog.Logger](i).With("hook", "task-notify-hook"),
		repo:   do.MustInvoke[domain.TaskRepo](i),
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
	logger := h.logger.With("task_id", taskID, "from", from, "to", to)

	task, err := h.repo.GetByID(ctx, taskID)
	if err != nil {
		logger.With("error", err).ErrorContext(ctx, "failed to get task on state change")
		return err
	}

	payload := domain.NotifyEventPayload{
		TaskID:      taskID.String(),
		TaskStatus:  string(to),
		TaskContent: task.Content,
		VMName:      "",
		VMArch:      "",
		VMCores:     0,
		VMMemory:    0,
		VMOS:        "",
	}
	if u := task.Edges.User; u != nil {
		payload.UserName = u.Name
	}
	if pts := task.Edges.ProjectTasks; len(pts) > 0 {
		pt := pts[0]
		if m := pt.Edges.Model; m != nil {
			payload.ModelName = m.Model
		}
	}
	if vms := task.Edges.Vms; len(vms) > 0 {
		vm := vms[0]
		payload.VMID = vm.ID
		payload.VMName = vm.Name
		payload.VMArch = vm.Arch
		payload.VMCores = vm.Cores
		payload.VMMemory = vm.Memory
		payload.VMOS = vm.Os
	}

	event := &domain.NotifyEvent{
		EventType:     eventType,
		SubjectUserID: metadata.UserID,
		RefID:         taskID.String(),
		Payload:       payload,
		OccurredAt:    time.Now(),
	}

	logger.InfoContext(ctx, "publishing notify event", "event", eventType)
	return h.notify.Publish(ctx, event)
}
