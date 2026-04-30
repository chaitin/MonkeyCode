package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

type VMIdleRefresher interface {
	Refresh(ctx context.Context, vmID string) error
}

const (
	sleepQueueKey   = "vm:idle:sleep"
	notifyQueueKey  = "vm:idle:notify"
	recycleQueueKey = "vm:idle:recycle"
	notifyLead      = time.Hour
)

type vmIdleRefresher struct {
	cfg              *config.Config
	redis            *redis.Client
	taskflow         taskflow.Clienter
	logger           *slog.Logger
	hostRepo         domain.HostRepo
	taskRepo         domain.TaskRepo
	notifyDispatcher *dispatcher.Dispatcher
	sleepQueue       *delayqueue.VMSleepQueue
	notifyQueue      *delayqueue.VMNotifyQueue
	recycleQueue     *delayqueue.VMRecycleQueue
}

func NewVMIdleRefresher(i *do.Injector) (VMIdleRefresher, error) {
	r := &vmIdleRefresher{
		cfg:              do.MustInvoke[*config.Config](i),
		redis:            do.MustInvoke[*redis.Client](i),
		taskflow:         do.MustInvoke[taskflow.Clienter](i),
		logger:           do.MustInvoke[*slog.Logger](i).With("module", "VMIdleRefresher"),
		hostRepo:         do.MustInvoke[domain.HostRepo](i),
		taskRepo:         do.MustInvoke[domain.TaskRepo](i),
		notifyDispatcher: do.MustInvoke[*dispatcher.Dispatcher](i),
		sleepQueue:       do.MustInvoke[*delayqueue.VMSleepQueue](i),
		notifyQueue:      do.MustInvoke[*delayqueue.VMNotifyQueue](i),
		recycleQueue:     do.MustInvoke[*delayqueue.VMRecycleQueue](i),
	}

	go r.sleepConsumer()
	go r.notifyConsumer()
	go r.recycleConsumer()

	return r, nil
}

func (r *vmIdleRefresher) sleepDelay() time.Duration {
	return time.Duration(r.cfg.VMIdle.SleepSeconds) * time.Second
}

func (r *vmIdleRefresher) recycleDelay() time.Duration {
	return time.Duration(r.cfg.VMIdle.RecycleSeconds) * time.Second
}

func (r *vmIdleRefresher) notifyDelay() time.Duration {
	d := r.recycleDelay()
	if d <= notifyLead {
		return 0
	}
	return d - notifyLead
}

func (r *vmIdleRefresher) notifyRemaining() time.Duration {
	d := r.recycleDelay()
	if d <= notifyLead {
		return d
	}
	return notifyLead
}

func (r *vmIdleRefresher) Refresh(ctx context.Context, vmID string) error {
	vm, err := r.hostRepo.GetVirtualMachine(ctx, vmID)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to get vm", "vmID", vmID, "error", err)
		return fmt.Errorf("get vm %s: %w", vmID, err)
	}

	if len(vm.Edges.Tasks) == 0 {
		r.logger.DebugContext(ctx, "skip idle timer for countdown VM", "vmID", vmID)
		return nil
	}

	debounceKey := fmt.Sprintf("vm:idle:debounce:%s", vmID)
	ok, err := r.redis.SetNX(ctx, debounceKey, "1", 30*time.Second).Result()
	if err != nil {
		r.logger.ErrorContext(ctx, "redis SetNX failed", "vmID", vmID, "error", err)
		return fmt.Errorf("redis debounce for vm %s: %w", vmID, err)
	}
	if !ok {
		return nil
	}

	payload := &domain.VmIdleInfo{
		UID:    vm.UserID,
		VmID:   vm.ID,
		HostID: vm.HostID,
		EnvID:  vm.EnvironmentID,
	}

	now := time.Now()
	var errs []error
	if _, err := r.sleepQueue.Enqueue(ctx, sleepQueueKey, payload, now.Add(r.sleepDelay()), vmID); err != nil {
		r.logger.ErrorContext(ctx, "failed to enqueue sleep", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("enqueue sleep: %w", err))
	}
	if _, err := r.notifyQueue.Enqueue(ctx, notifyQueueKey, payload, now.Add(r.notifyDelay()), vmID); err != nil {
		r.logger.ErrorContext(ctx, "failed to enqueue notify", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("enqueue notify: %w", err))
	}
	if _, err := r.recycleQueue.Enqueue(ctx, recycleQueueKey, payload, now.Add(r.recycleDelay()), vmID); err != nil {
		r.logger.ErrorContext(ctx, "failed to enqueue recycle", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("enqueue recycle: %w", err))
	}
	return errors.Join(errs...)
}

func (r *vmIdleRefresher) sleepConsumer() {
	logger := r.logger.With("fn", "sleepConsumer")
	for {
		err := r.sleepQueue.StartConsumer(context.Background(), sleepQueueKey,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm idle sleep triggered", "vmID", job.Payload.VmID)
				vm, err := r.hostRepo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				if err := r.taskflow.VirtualMachiner().Hibernate(ctx, &taskflow.HibernateVirtualMachineReq{
					HostID:        vm.HostID,
					UserID:        vm.UserID.String(),
					ID:            vm.ID,
					EnvironmentID: vm.EnvironmentID,
				}); err != nil {
					return fmt.Errorf("hibernate vm %s: %w", vm.ID, err)
				}
				return nil
			})
		logger.Warn("sleep consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

func (r *vmIdleRefresher) notifyConsumer() {
	logger := r.logger.With("fn", "notifyConsumer")
	for {
		err := r.notifyQueue.StartConsumer(context.Background(), notifyQueueKey,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm recycle notify triggered", "vmID", job.Payload.VmID)
				vm, err := r.hostRepo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				event, err := r.buildRecycleNotifyEvent(ctx, vm, time.Now().Add(r.notifyRemaining()))
				if err != nil {
					return err
				}
				if event == nil {
					return nil
				}
				return r.notifyDispatcher.Publish(ctx, event)
			})
		logger.Warn("notify consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

func (r *vmIdleRefresher) recycleConsumer() {
	logger := r.logger.With("fn", "recycleConsumer")
	for {
		err := r.recycleQueue.StartConsumer(context.Background(), recycleQueueKey,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm recycle triggered", "vmID", job.Payload.VmID)

				ctx = entx.SkipSoftDelete(ctx)
				vm, err := r.hostRepo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				if err := r.hostRepo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
					vmuo.SetIsRecycled(true)
					return nil
				}); err != nil {
					return err
				}

				if err := r.markRecycledTasksFinished(ctx, vm); err != nil {
					return err
				}

				if err := r.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
					UserID: vm.UserID.String(),
					HostID: vm.HostID,
					ID:     vm.EnvironmentID,
				}); err != nil {
					return fmt.Errorf("delete vm %s: %w", vm.ID, err)
				}

				return nil
			})
		logger.Warn("recycle consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

func (r *vmIdleRefresher) markRecycledTasksFinished(ctx context.Context, vm *db.VirtualMachine) error {
	var errs []error
	for _, tk := range vm.Edges.Tasks {
		if tk == nil {
			continue
		}
		if tk.Status == consts.TaskStatusFinished || tk.Status == consts.TaskStatusError {
			continue
		}
		err := r.taskRepo.Update(ctx, nil, tk.ID, func(up *db.TaskUpdateOne) error {
			up.SetStatus(consts.TaskStatusFinished)
			up.SetCompletedAt(time.Now())
			return nil
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("update task %s: %w", tk.ID, err))
		}
	}
	return errors.Join(errs...)
}

func (r *vmIdleRefresher) buildRecycleNotifyEvent(ctx context.Context, vm *db.VirtualMachine, expiresAt time.Time) (*domain.NotifyEvent, error) {
	if len(vm.Edges.Tasks) == 0 || vm.Edges.Tasks[0] == nil {
		return nil, nil
	}

	tk, err := r.taskRepo.GetByID(ctx, vm.Edges.Tasks[0].ID)
	if err != nil {
		return nil, fmt.Errorf("get task %s: %w", vm.Edges.Tasks[0].ID, err)
	}

	event := &domain.NotifyEvent{
		EventType:     consts.NotifyEventVMExpiringSoon,
		SubjectUserID: tk.UserID,
		RefID:         tk.ID.String(),
		OccurredAt:    time.Now(),
		Payload: domain.NotifyEventPayload{
			TaskID:      tk.ID.String(),
			TaskContent: tk.Content,
			TaskStatus:  string(tk.Status),
			TaskURL:     strings.TrimRight(r.cfg.Server.BaseURL, "/") + "/console/task/" + tk.ID.String(),
			VMID:        vm.ID,
			VMName:      vm.Name,
			HostID:      vm.HostID,
			VMArch:      vm.Arch,
			VMCores:     vm.Cores,
			VMMemory:    vm.Memory,
			VMOS:        vm.Os,
			ExpiresAt:   &expiresAt,
		},
	}

	if len(tk.Edges.ProjectTasks) > 0 && tk.Edges.ProjectTasks[0] != nil {
		pt := tk.Edges.ProjectTasks[0]
		event.Payload.RepoURL = pt.RepoURL
		if pt.Edges.Model != nil {
			event.Payload.ModelName = pt.Edges.Model.Model
		}
	}

	if vm.Edges.User != nil {
		event.Payload.UserName = vm.Edges.User.Name
	}

	return event, nil
}
