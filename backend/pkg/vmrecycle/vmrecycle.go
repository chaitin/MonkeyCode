package vmrecycle

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

const (
	SleepQueueKey     = "vm:idle:sleep"
	NotifyQueueKey    = "vm:idle:notify"
	RecycleQueueKey   = "vm:idle:recycle"
	VMExpireQueueKey  = "vm:expire"
	wechat2hQueueKey  = "vm:idle:notify:wechat:2h"
	wechat15mQueueKey = "vm:idle:notify:wechat:15m"
	recycleLockTTL    = 10 * time.Minute
)

type Status string

const (
	StatusRecycled        Status = "recycled"
	StatusAlreadyRecycled Status = "already_recycled"
	StatusNotFound        Status = "not_found"
)

var (
	ErrInProgress   = errors.New("vm recycle in progress")
	ErrRemoteDelete = errors.New("vm remote delete failed")
)

type Result struct {
	VMID    string
	TaskIDs []uuid.UUID
	Status  Status
}

type Recycler interface {
	Recycle(ctx context.Context, vmID string) (Result, error)
}

type removableQueue interface {
	Remove(ctx context.Context, queue, id string) error
}

type notifyQueue interface {
	removableQueue
	RemoveByPrefix(ctx context.Context, queue, prefix string) (int, error)
}

type recycler struct {
	redis        *redis.Client
	logger       *slog.Logger
	hostRepo     domain.HostRepo
	taskRepo     domain.TaskRepo
	taskflow     taskflow.Clienter
	sleepQueue   removableQueue
	notifyQueue  notifyQueue
	recycleQueue removableQueue
	expireQueue  removableQueue
	now          func() time.Time
}

func NewRecycler(i *do.Injector) (Recycler, error) {
	return &recycler{
		redis:        do.MustInvoke[*redis.Client](i),
		logger:       do.MustInvoke[*slog.Logger](i).With("module", "VMRecycler"),
		hostRepo:     do.MustInvoke[domain.HostRepo](i),
		taskRepo:     do.MustInvoke[domain.TaskRepo](i),
		taskflow:     do.MustInvoke[taskflow.Clienter](i),
		sleepQueue:   do.MustInvoke[*delayqueue.VMSleepQueue](i),
		notifyQueue:  do.MustInvoke[*delayqueue.VMNotifyQueue](i),
		recycleQueue: do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		expireQueue:  do.MustInvoke[*delayqueue.VMExpireQueue](i),
		now:          time.Now,
	}, nil
}

func (r *recycler) Recycle(ctx context.Context, vmID string) (Result, error) {
	result := Result{VMID: vmID}
	token, err := r.acquire(ctx, vmID)
	if err != nil {
		return result, err
	}
	defer r.release(ctx, vmID, token)

	ctx = entx.SkipSoftDelete(ctx)
	vm, err := r.hostRepo.GetVirtualMachine(ctx, vmID)
	if err != nil {
		if db.IsNotFound(err) {
			result.Status = StatusNotFound
			return result, nil
		}
		return result, fmt.Errorf("get vm %s: %w", vmID, err)
	}
	result.TaskIDs = taskIDs(vm)

	if vm.IsRecycled {
		result.Status = StatusAlreadyRecycled
	} else {
		if err := r.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
			UserID: vm.UserID.String(),
			HostID: vm.HostID,
			ID:     vm.EnvironmentID,
		}); err != nil {
			return result, fmt.Errorf("%w: delete vm %s: %w", ErrRemoteDelete, vmID, err)
		}
		if err := r.hostRepo.UpdateVirtualMachine(ctx, vmID, func(up *db.VirtualMachineUpdateOne) error {
			up.SetIsRecycled(true)
			return nil
		}); err != nil {
			return result, fmt.Errorf("mark vm %s recycled: %w", vmID, err)
		}
		result.Status = StatusRecycled
	}

	if err := r.cleanup(ctx, vm); err != nil {
		return result, err
	}
	r.logger.InfoContext(ctx, "vm recycled", "vm_id", vmID, "status", result.Status, "task_ids", result.TaskIDs)
	return result, nil
}

func (r *recycler) acquire(ctx context.Context, vmID string) (string, error) {
	token := uuid.NewString()
	err := r.redis.SetArgs(ctx, recycleLockKey(vmID), token, redis.SetArgs{Mode: "NX", TTL: recycleLockTTL}).Err()
	if errors.Is(err, redis.Nil) {
		return "", fmt.Errorf("%w: %s", ErrInProgress, vmID)
	}
	if err != nil {
		return "", fmt.Errorf("acquire recycle lock for vm %s: %w", vmID, err)
	}
	return token, nil
}

func (r *recycler) release(ctx context.Context, vmID, token string) {
	const script = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`
	if err := r.redis.Eval(ctx, script, []string{recycleLockKey(vmID)}, token).Err(); err != nil && !errors.Is(err, redis.Nil) {
		r.logger.WarnContext(ctx, "failed to release vm recycle lock", "vm_id", vmID, "error", err)
	}
}

func (r *recycler) cleanup(ctx context.Context, vm *db.VirtualMachine) error {
	var errs []error
	completedAt := r.now()
	for _, tk := range vm.Edges.Tasks {
		if tk == nil || tk.Status == consts.TaskStatusFinished || tk.Status == consts.TaskStatusError {
			continue
		}
		if err := r.taskRepo.Update(ctx, nil, tk.ID, func(up *db.TaskUpdateOne) error {
			up.SetStatus(consts.TaskStatusFinished)
			up.SetCompletedAt(completedAt)
			return nil
		}); err != nil {
			errs = append(errs, fmt.Errorf("finish task %s: %w", tk.ID, err))
		}
	}

	remove := func(name string, queue removableQueue, queueKey, id string) {
		if err := queue.Remove(ctx, queueKey, id); err != nil {
			errs = append(errs, fmt.Errorf("remove %s: %w", name, err))
		}
	}
	remove("sleep job", r.sleepQueue, SleepQueueKey, vm.ID)
	if _, err := r.notifyQueue.RemoveByPrefix(ctx, NotifyQueueKey, vm.ID+":"); err != nil {
		errs = append(errs, fmt.Errorf("remove notify jobs: %w", err))
	}
	remove("legacy notify job", r.notifyQueue, NotifyQueueKey, vm.ID)
	remove("legacy wechat 2h notify job", r.notifyQueue, wechat2hQueueKey, vm.ID)
	remove("legacy wechat 15m notify job", r.notifyQueue, wechat15mQueueKey, vm.ID)
	remove("expire job", r.expireQueue, VMExpireQueueKey, vm.ID)

	keys := []string{
		fmt.Sprintf("lifecycle:%s", vm.ID),
		fmt.Sprintf("vm:idle:debounce:%s", vm.ID),
		fmt.Sprintf("vm:idle:debounce:%s:keep-awake", vm.ID),
		fmt.Sprintf("vm:idle:debounce:%s:activity", vm.ID),
		fmt.Sprintf("vm:idle:not-found:%s", vm.ID),
	}
	for _, taskID := range taskIDs(vm) {
		keys = append(keys,
			fmt.Sprintf("task:create_req:%s", taskID),
			fmt.Sprintf("mcai:task:%s:last_input", taskID),
		)
	}
	if err := r.redis.Del(ctx, keys...).Err(); err != nil {
		errs = append(errs, fmt.Errorf("delete recycle redis keys: %w", err))
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	if err := r.recycleQueue.Remove(ctx, RecycleQueueKey, vm.ID); err != nil {
		return fmt.Errorf("remove recycle job: %w", err)
	}
	return nil
}

func taskIDs(vm *db.VirtualMachine) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(vm.Edges.Tasks))
	ids := make([]uuid.UUID, 0, len(vm.Edges.Tasks))
	for _, tk := range vm.Edges.Tasks {
		if tk == nil {
			continue
		}
		if _, ok := seen[tk.ID]; ok {
			continue
		}
		seen[tk.ID] = struct{}{}
		ids = append(ids, tk.ID)
	}
	return ids
}

func recycleLockKey(vmID string) string {
	return fmt.Sprintf("vm:recycle:lock:%s", vmID)
}
