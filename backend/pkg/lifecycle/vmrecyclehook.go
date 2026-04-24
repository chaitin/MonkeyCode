package lifecycle

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

const (
	vmSleepQueueKey   = "vm:idle:sleep"
	vmNotifyQueueKey  = "vm:idle:notify"
	vmRecycleQueueKey = "vm:idle:recycle"
	vmExpireQueueKey  = "vm:expire"
)

// VMRecycleHook VM 回收 Hook，负责删除 VM、清理队列和 Redis 键、标记 DB
type VMRecycleHook struct {
	taskflow       taskflow.Clienter
	redis          *redis.Client
	hostRepo       domain.HostRepo
	vmSleepQueue   *delayqueue.VMSleepQueue
	vmNotifyQueue  *delayqueue.VMNotifyQueue
	vmRecycleQueue *delayqueue.VMRecycleQueue
	vmExpireQueue  *delayqueue.VMExpireQueue
	logger         *slog.Logger
}

// NewVMRecycleHook 创建 VM 回收 Hook
func NewVMRecycleHook(i *do.Injector) *VMRecycleHook {
	return &VMRecycleHook{
		taskflow:       do.MustInvoke[taskflow.Clienter](i),
		redis:          do.MustInvoke[*redis.Client](i),
		hostRepo:       do.MustInvoke[domain.HostRepo](i),
		vmSleepQueue:   do.MustInvoke[*delayqueue.VMSleepQueue](i),
		vmNotifyQueue:  do.MustInvoke[*delayqueue.VMNotifyQueue](i),
		vmRecycleQueue: do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		vmExpireQueue:  do.MustInvoke[*delayqueue.VMExpireQueue](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("hook", "vm-recycle-hook"),
	}
}

func (h *VMRecycleHook) Name() string  { return "vm-recycle-hook" }
func (h *VMRecycleHook) Priority() int { return 110 }
func (h *VMRecycleHook) Async() bool   { return false }

func (h *VMRecycleHook) OnStateChange(ctx context.Context, vmID string, from, to VMState, metadata VMMetadata) error {
	if to != VMStateRecycled {
		return nil
	}

	logger := h.logger.With("vm_id", vmID, "task_id", metadata.TaskID)
	logger.InfoContext(ctx, "recycling VM")

	// 1. 查询 VM 完整信息
	ctx = entx.SkipSoftDelete(ctx)
	vm, err := h.hostRepo.GetVirtualMachine(ctx, vmID)
	if err != nil {
		logger.ErrorContext(ctx, "failed to get VM info", "error", err)
		return nil // VM 不存在则跳过
	}

	if vm.IsRecycled {
		logger.InfoContext(ctx, "VM already recycled, skipping")
		return nil
	}

	// 2. 删除 VM
	if err := h.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
		UserID: metadata.UserID.String(),
		HostID: vm.HostID,
		ID:     vm.EnvironmentID,
	}); err != nil {
		logger.ErrorContext(ctx, "failed to delete VM, falling back to recycle queue", "error", err)
		h.enqueueRetry(ctx, vm, metadata)
		return nil
	}

	// 3-6. 清理操作（失败仅记录日志）
	h.cleanup(ctx, logger, vm, metadata)

	return nil
}

// enqueueRetry 将 VM 投入 vmRecycleQueue 进行重试
func (h *VMRecycleHook) enqueueRetry(ctx context.Context, vm *db.VirtualMachine, metadata VMMetadata) {
	taskID := ""
	if metadata.TaskID != nil {
		taskID = metadata.TaskID.String()
	}
	payload := &domain.VmIdleInfo{
		UID:    metadata.UserID,
		VmID:   vm.ID,
		HostID: vm.HostID,
		EnvID:  vm.EnvironmentID,
		TaskID: taskID,
	}
	if _, err := h.vmRecycleQueue.Enqueue(ctx, vmRecycleQueueKey, payload, time.Now(), vm.ID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue VM for retry", "vm_id", vm.ID, "error", err)
	}
}

// cleanup 清理 delay queue、Redis 键、标记 DB
func (h *VMRecycleHook) cleanup(ctx context.Context, logger *slog.Logger, vm *db.VirtualMachine, metadata VMMetadata) {
	// 3. 清理 delay queue 条目
	_ = h.vmSleepQueue.Remove(ctx, vmSleepQueueKey, vm.ID)
	_ = h.vmNotifyQueue.Remove(ctx, vmNotifyQueueKey, vm.ID)
	_ = h.vmRecycleQueue.Remove(ctx, vmRecycleQueueKey, vm.ID)
	_ = h.vmExpireQueue.Remove(ctx, vmExpireQueueKey, vm.ID)

	// 4. 清理 task 相关 Redis 键
	if metadata.TaskID != nil {
		taskIDStr := metadata.TaskID.String()
		if err := h.redis.Del(ctx,
			fmt.Sprintf("task:create_req:%s", taskIDStr),
			fmt.Sprintf("mcai:task:%s:last_input", taskIDStr),
		).Err(); err != nil {
			logger.WarnContext(ctx, "failed to clean task redis keys", "error", err)
		}
	}

	// 5. DB 标记 is_recycled = true
	if err := h.hostRepo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
		vmuo.SetIsRecycled(true)
		return nil
	}); err != nil {
		logger.WarnContext(ctx, "failed to mark VM as recycled", "error", err)
	}

	// 6. 清理 lifecycle Redis 键（最后执行）
	lifecycleKey := fmt.Sprintf("lifecycle:%s", vm.ID)
	if err := h.redis.Del(ctx, lifecycleKey).Err(); err != nil {
		logger.WarnContext(ctx, "failed to clean lifecycle key", "error", err)
	}

	logger.InfoContext(ctx, "VM recycled successfully")
}
