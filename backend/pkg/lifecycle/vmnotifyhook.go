package lifecycle

import (
	"context"
	"log/slog"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
)

// NotifyPublisher 通知发布接口
type NotifyPublisher interface {
	Publish(ctx context.Context, event *domain.NotifyEvent) error
}

// VMNotifyHook VM 状态变更时发送通知
type VMNotifyHook struct {
	notify NotifyPublisher
	logger *slog.Logger
}

// NewVMNotifyHook 创建 VM 通知 Hook
func NewVMNotifyHook(i *do.Injector) *VMNotifyHook {
	return &VMNotifyHook{
		notify: do.MustInvoke[*dispatcher.Dispatcher](i),
		logger: do.MustInvoke[*slog.Logger](i).With("hook", "vm-notify-hook"),
	}
}

func (h *VMNotifyHook) Name() string  { return "vm-notify-hook" }
func (h *VMNotifyHook) Priority() int { return 50 }
func (h *VMNotifyHook) Async() bool   { return true } // 异步执行，不阻塞状态转换

func (h *VMNotifyHook) OnStateChange(ctx context.Context, vmID string, from, to VMState, metadata VMMetadata) error {
	var eventType consts.NotifyEventType
	switch to {
	case VMStateRunning:
		eventType = consts.NotifyEventVMReady
	case VMStateFailed:
		eventType = consts.NotifyEventVMFailed
	case VMStateSucceeded:
		eventType = consts.NotifyEventVMCompleted
	default:
		return nil
	}

	event := &domain.NotifyEvent{
		EventType:     eventType,
		SubjectUserID: metadata.UserID,
		RefID:         vmID,
		Payload: domain.NotifyEventPayload{
			VMID:     vmID,
			VMStatus: string(to),
		},
	}

	h.logger.InfoContext(ctx, "publishing notify event", "event", eventType, "vm_id", vmID)
	return h.notify.Publish(ctx, event)
}
