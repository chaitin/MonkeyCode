package vmrecycle

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/virtualmachine"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
)

type DeadlineRepairResult struct {
	VMID      string
	RecycleAt time.Time
	Repaired  bool
}

type DeadlineRepairer interface {
	Repair(ctx context.Context, vmID string) (DeadlineRepairResult, error)
}

type deadlineQueue interface {
	EnqueueIfMissing(ctx context.Context, queue string, payload *domain.VmIdleInfo, runAt time.Time, id string) (string, bool, error)
	GetRunAt(ctx context.Context, queue, id string) (time.Time, bool, error)
}

type deadlineRepairer struct {
	cfg            *config.Config
	db             *db.Client
	teamPolicyRepo domain.TeamPolicyRepo
	queue          deadlineQueue
	now            func() time.Time
}

func NewDeadlineRepairer(i *do.Injector) (DeadlineRepairer, error) {
	return &deadlineRepairer{
		cfg:            do.MustInvoke[*config.Config](i),
		db:             do.MustInvoke[*db.Client](i),
		teamPolicyRepo: do.MustInvoke[domain.TeamPolicyRepo](i),
		queue:          do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		now:            time.Now,
	}, nil
}

func (r *deadlineRepairer) Repair(ctx context.Context, vmID string) (DeadlineRepairResult, error) {
	result := DeadlineRepairResult{VMID: vmID}
	vm, err := r.db.VirtualMachine.Query().Where(virtualmachine.ID(vmID)).WithTasks().Only(ctx)
	if err != nil {
		return result, fmt.Errorf("query VM: %w", err)
	}
	if vm.IsRecycled {
		return result, fmt.Errorf("VM already recycled")
	}
	if !hasNonTerminalTask(vm.Edges.Tasks) {
		return result, fmt.Errorf("VM has no non-terminal task")
	}

	policy, err := resolvePolicy(ctx, r.teamPolicyRepo, r.cfg.VMIdle, vm.UserID)
	if err != nil {
		return result, fmt.Errorf("resolve recycle policy: %w", err)
	}
	if !policy.RecycleEnabled {
		return result, fmt.Errorf("recycle disabled")
	}

	recycleAt := r.now().Add(time.Duration(policy.EffectiveRecycleSeconds) * time.Second)
	payload := &domain.VmIdleInfo{
		UID:       vm.UserID,
		VmID:      vm.ID,
		HostID:    vm.HostID,
		EnvID:     vm.EnvironmentID,
		RecycleAt: recycleAt,
	}
	_, added, err := r.queue.EnqueueIfMissing(ctx, RecycleQueueKey, payload, recycleAt, vm.ID)
	if err != nil {
		return result, fmt.Errorf("enqueue recycle deadline: %w", err)
	}
	result.Repaired = added
	if added {
		result.RecycleAt = recycleAt
		return result, nil
	}

	existingAt, ok, err := r.queue.GetRunAt(ctx, RecycleQueueKey, vm.ID)
	if err != nil {
		return result, fmt.Errorf("query existing recycle deadline: %w", err)
	}
	if ok {
		result.RecycleAt = existingAt
	}
	return result, nil
}

func hasNonTerminalTask(tasks []*db.Task) bool {
	for _, task := range tasks {
		if task != nil && task.Status != consts.TaskStatusFinished && task.Status != consts.TaskStatusError {
			return true
		}
	}
	return false
}

func resolvePolicy(ctx context.Context, repo domain.TeamPolicyRepo, cfg config.VMIdle, userID uuid.UUID) (*domain.TeamTaskVMIdlePolicy, error) {
	team, err := repo.GetTeamByUserID(ctx, userID)
	if err != nil && !db.IsNotFound(err) {
		return nil, err
	}
	if db.IsNotFound(err) {
		team = nil
	}
	return domain.ResolveTeamTaskVMIdlePolicy(team, cfg)
}

var _ DeadlineRepairer = (*deadlineRepairer)(nil)
var _ deadlineQueue = (*delayqueue.VMRecycleQueue)(nil)
