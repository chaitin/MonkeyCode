package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/vmrecycle"
)

type VMRecycleHook struct {
	recycler     vmrecycle.Recycler
	recycleQueue *delayqueue.VMRecycleQueue
	logger       *slog.Logger
}

func NewVMRecycleHook(i *do.Injector) *VMRecycleHook {
	return &VMRecycleHook{
		recycler:     do.MustInvoke[vmrecycle.Recycler](i),
		recycleQueue: do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		logger:       do.MustInvoke[*slog.Logger](i).With("hook", "vm-recycle-hook"),
	}
}

func (h *VMRecycleHook) Name() string  { return "vm-recycle-hook" }
func (h *VMRecycleHook) Priority() int { return 100 }
func (h *VMRecycleHook) Async() bool   { return false }

func (h *VMRecycleHook) OnStateChange(ctx context.Context, vmID string, _, to VMState, metadata VMMetadata) error {
	if to != VMStateRecycled {
		return nil
	}

	if _, err := h.recycler.Recycle(ctx, vmID); err == nil {
		return nil
	} else {
		h.logger.WarnContext(ctx, "vm recycle failed, enqueueing retry", "vm_id", vmID, "error", err)
		payload := &domain.VmIdleInfo{UID: metadata.UserID, VmID: vmID}
		if metadata.TaskID != nil {
			payload.TaskID = metadata.TaskID.String()
		}
		if _, queueErr := h.recycleQueue.Enqueue(ctx, vmrecycle.RecycleQueueKey, payload, time.Now(), vmID); queueErr != nil {
			return errors.Join(
				fmt.Errorf("recycle vm %s: %w", vmID, err),
				fmt.Errorf("enqueue vm %s recycle retry: %w", vmID, queueErr),
			)
		}
		return nil
	}
}
