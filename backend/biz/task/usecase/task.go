package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/tasker"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TaskUsecase 任务业务逻辑实现
type TaskUsecase struct {
	cfg              *config.Config
	repo             domain.TaskRepo
	modelRepo        domain.ModelRepo
	logger           *slog.Logger
	tasker           *tasker.Tasker[*domain.TaskSession]
	taskflow         taskflow.Clienter
	loki             *loki.Client
	vmexpireQueue    *delayqueue.VMExpireQueue
	redis            *redis.Client
	notifyDispatcher *dispatcher.Dispatcher
	taskHook         domain.TaskHook // 可选，由内部项目通过 TaskHook 注入
}

// NewTaskUsecase 创建任务业务逻辑实例
func NewTaskUsecase(i *do.Injector) (domain.TaskUsecase, error) {
	u := &TaskUsecase{
		cfg:              do.MustInvoke[*config.Config](i),
		repo:             do.MustInvoke[domain.TaskRepo](i),
		modelRepo:        do.MustInvoke[domain.ModelRepo](i),
		logger:           do.MustInvoke[*slog.Logger](i).With("module", "usecase.TaskUsecase"),
		tasker:           do.MustInvoke[*tasker.Tasker[*domain.TaskSession]](i),
		taskflow:         do.MustInvoke[taskflow.Clienter](i),
		loki:             do.MustInvoke[*loki.Client](i),
		vmexpireQueue:    do.MustInvoke[*delayqueue.VMExpireQueue](i),
		redis:            do.MustInvoke[*redis.Client](i),
		notifyDispatcher: do.MustInvoke[*dispatcher.Dispatcher](i),
	}

	// 可选注入 TaskHook
	if hook, err := do.Invoke[domain.TaskHook](i); err == nil {
		u.taskHook = hook
	}

	u.tasker.On(tasker.PhaseCreated, u.onCreated)
	u.tasker.On(tasker.PhaseStarted, u.onStarted)
	u.tasker.On(tasker.PhaseRunning, u.onRunning)
	u.tasker.On(tasker.PhaseFinished, u.onFinished)
	u.tasker.On(tasker.PhaseFailed, u.onFailed)

	go u.tasker.StartGroupConsumers(context.Background(), "task", "consumer-1", 0, 20)

	return u, nil
}

func (a *TaskUsecase) onFailed(ctx context.Context, task tasker.Task[*domain.TaskSession]) {
	a.logger.With("task", task).DebugContext(ctx, "on failed")
	err := a.repo.Update(ctx, task.Payload.User, task.Payload.Task.TaskID, func(up *db.TaskUpdateOne) error {
		up.SetStatus(consts.TaskStatusError)
		return nil
	})
	if err != nil {
		a.logger.With("error", err, "task", task).ErrorContext(ctx, "failed to update task to failed")
	}
	if err := a.tasker.CleanupTask(ctx, task.ID, task.Phase); err != nil {
		a.logger.With("error", err, "task", task).ErrorContext(ctx, "failed to cleanup task data")
	}
}

func (a *TaskUsecase) onFinished(ctx context.Context, task tasker.Task[*domain.TaskSession]) {
	a.logger.With("task", task).DebugContext(ctx, "on completed")
	err := a.repo.Update(ctx, task.Payload.User, task.Payload.Task.TaskID, func(up *db.TaskUpdateOne) error {
		up.SetStatus(consts.TaskStatusFinished)
		return nil
	})
	if err != nil {
		a.logger.With("error", err, "task", task).ErrorContext(ctx, "failed to update task to completed")
	}
	if err := a.tasker.CleanupTask(ctx, task.ID, task.Phase); err != nil {
		a.logger.With("error", err, "task", task).ErrorContext(ctx, "failed to cleanup task data")
	}
}

func (a *TaskUsecase) onRunning(ctx context.Context, task tasker.Task[*domain.TaskSession]) {
	a.logger.With("task", task).DebugContext(ctx, "on running")
}

func (a *TaskUsecase) onCreated(ctx context.Context, task tasker.Task[*domain.TaskSession]) {
	a.logger.With("task", task).DebugContext(ctx, "on created")

	// 发布 task.created 通知事件
	if task.Payload != nil && task.Payload.User != nil && task.Payload.Task != nil {
		event := &domain.NotifyEvent{
			EventType:     consts.NotifyEventTaskCreated,
			SubjectUserID: task.Payload.User.ID,
			RefID:         task.Payload.Task.TaskID.String(),
			OccurredAt:    time.Now(),
			Payload: domain.NotifyEventPayload{
				TaskID:     task.Payload.Task.TaskID.String(),
				TaskStatus: string(consts.TaskStatusProcessing),
				ModelName:  task.Payload.Task.LLM.Model,
				UserName:   task.Payload.User.Name,
			},
		}
		if err := a.notifyDispatcher.Publish(ctx, event); err != nil {
			a.logger.WarnContext(ctx, "failed to publish task.created event", "error", err)
		}
	}
}

func (a *TaskUsecase) onStarted(ctx context.Context, task tasker.Task[*domain.TaskSession]) {
	a.logger.With("task", task).DebugContext(ctx, "on started task")
	if err := a.repo.Update(ctx, task.Payload.User, task.Payload.Task.TaskID, func(up *db.TaskUpdateOne) error {
		if err := a.taskflow.TaskManager().Create(ctx, *task.Payload.Task); err != nil {
			return err
		}
		up.SetStatus(consts.TaskStatusProcessing)
		return nil
	}); err != nil {
		a.logger.With("error", err, "task", task).ErrorContext(ctx, "failed to update task status")
		return
	}

	if err := a.tasker.TransitionWithUpdate(ctx, task.ID, tasker.PhaseRunning, func(t *tasker.Task[*domain.TaskSession]) error {
		minimal := &domain.TaskSession{
			Platform: t.Payload.Platform,
			ShowUrl:  t.Payload.ShowUrl,
		}
		if t.Payload.Task != nil {
			minimal.Task = &taskflow.CreateVirtualMachineReq{
				TaskID: t.Payload.Task.TaskID,
			}
		}
		if t.Payload.User != nil {
			minimal.User = &domain.User{ID: t.Payload.User.ID}
		}
		t.Payload = minimal
		return nil
	}); err != nil {
		a.logger.With("error", err, "task", task).ErrorContext(ctx, "failed to transition task to running phase")
	} else {
		a.logger.With("task", task).DebugContext(ctx, "transition to running")
	}
}

// AutoApprove implements domain.TaskUsecase.
func (a *TaskUsecase) AutoApprove(ctx context.Context, _ *domain.User, id uuid.UUID, approve bool) error {
	return a.taskflow.TaskManager().AutoApprove(ctx, taskflow.TaskApproveReq{
		ID:          id,
		AutoApprove: &approve,
	})
}

// Info implements domain.TaskUsecase.
func (a *TaskUsecase) Info(ctx context.Context, user *domain.User, id uuid.UUID) (*domain.Task, bool, error) {
	ctx = entx.SkipSoftDelete(ctx)

	t, err := a.repo.Info(ctx, user, id)
	if err != nil {
		return nil, false, err
	}

	owner := user.ID == t.UserID

	tk := cvt.From(t, &domain.Task{})
	if vm := tk.VirtualMachine; vm != nil {
		resp, _ := a.taskflow.VirtualMachiner().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
			IDs: []string{vm.ID},
		})

		if resp != nil && resp.OnlineMap[vm.ID] {
			vm.Status = taskflow.VirtualMachineStatusOnline
		} else {
			vm.Status = taskflow.VirtualMachineStatusPending

			for _, cond := range vm.Conditions {
				switch cond.Type {
				case types.ConditionTypeFailed:
					vm.Status = taskflow.VirtualMachineStatusOffline
				case types.ConditionTypeReady:
					if time.Since(time.Unix(vm.CreatedAt, 0)) > 2*time.Minute {
						vm.Status = taskflow.VirtualMachineStatusOffline
					}
				}
			}
		}

		// 端口信息
		ports, _ := a.taskflow.PortForwarder().List(ctx, vm.ID)
		if ports == nil {
			ports = []*taskflow.PortForwardInfo{}
		}
		vmPorts := cvt.Iter(ports, func(_ int, port *taskflow.PortForwardInfo) *domain.VMPort {
			return &domain.VMPort{
				ForwardID:    port.ForwardID,
				Port:         uint16(port.Port),
				Status:       consts.PortStatus(port.Status),
				WhiteList:    port.WhitelistIPs,
				ErrorMessage: port.ErrorMessage,
				PreviewURL:   port.AccessURL,
			}
		})
		sort.Slice(vmPorts, func(i, j int) bool {
			return vmPorts[i].Port < vmPorts[j].Port
		})
		vm.Ports = vmPorts
	}

	if stat, err := a.repo.Stat(ctx, id); err == nil {
		tk.Stats = stat
	}

	return tk, owner, nil
}

// List implements domain.TaskUsecase.
func (a *TaskUsecase) List(ctx context.Context, user *domain.User, req domain.TaskListReq) (*domain.ListTaskResp, error) {
	ctx = entx.SkipSoftDelete(ctx)
	projectTasks, pageInfo, err := a.repo.List(ctx, user, req)
	if err != nil {
		return nil, err
	}

	stat, err := a.repo.StatByIDs(ctx, cvt.Iter(projectTasks, func(_ int, pt *db.ProjectTask) uuid.UUID {
		return pt.TaskID
	}))
	if err != nil {
		return nil, err
	}

	tasks := cvt.Iter(projectTasks, func(_ int, pt *db.ProjectTask) *domain.ProjectTask {
		tmp := cvt.From(pt, &domain.ProjectTask{})
		if tmp.Task != nil {
			tmp.Task.Stats = stat[tmp.Task.ID]
		}
		return tmp
	})

	resp := &domain.ListTaskResp{Tasks: tasks}
	if pageInfo != nil {
		resp.PageInfo = pageInfo
	}
	return resp, nil
}

// Stop implements domain.TaskUsecase.
func (a *TaskUsecase) Stop(ctx context.Context, user *domain.User, id uuid.UUID) error {
	return a.repo.Stop(ctx, user, id, func(t *db.Task) error {
		return a.taskflow.TaskManager().Stop(ctx, taskflow.TaskReq{
			Task: &taskflow.TaskInfo{
				ID: id,
			},
		})
	})
}

// Cancel implements domain.TaskUsecase.
func (a *TaskUsecase) Cancel(ctx context.Context, user *domain.User, id uuid.UUID) error {
	t, err := a.repo.Info(ctx, user, id)
	if err != nil {
		return err
	}
	tk := cvt.From(t, &domain.Task{})

	if err := a.taskflow.TaskManager().Cancel(ctx, taskflow.TaskReq{
		VirtualMachine: &taskflow.VirtualMachine{ID: tk.VirtualMachine.ID},
		Task: &taskflow.TaskInfo{
			ID: id,
		},
	}); err != nil {
		return err
	}

	return nil
}

// Continue implements domain.TaskUsecase.
func (a *TaskUsecase) Continue(ctx context.Context, user *domain.User, id uuid.UUID, content string) error {
	t, err := a.repo.Info(ctx, user, id)
	if err != nil {
		return err
	}
	tk := cvt.From(t, &domain.Task{})

	if err := a.taskflow.TaskManager().Continue(ctx, taskflow.TaskReq{
		VirtualMachine: &taskflow.VirtualMachine{ID: tk.VirtualMachine.ID},
		Task: &taskflow.TaskInfo{
			ID:   id,
			Text: content,
		},
	}); err != nil {
		return err
	}

	// 缓存最近一次 user-input，供通知推送使用
	a.redis.Set(ctx, fmt.Sprintf("mcai:task:%s:last_input", id.String()), content, 24*time.Hour)

	return nil
}

// Create implements domain.TaskUsecase.
func (a *TaskUsecase) Create(ctx context.Context, user *domain.User, req domain.CreateTaskReq, token string) (*domain.ProjectTask, error) {
	r, err := a.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: []string{req.HostID},
	})
	if err != nil {
		return nil, errcode.ErrHostOffline.Wrap(err)
	}
	if !r.OnlineMap[req.HostID] {
		return nil, errcode.ErrHostOffline
	}

	TTLType := taskflow.TTLCountDown
	if req.Resource.Life <= 0 {
		TTLType = taskflow.TTLForever
	}

	req.Now = time.Now()

	// 如果有 TaskHook，获取系统提示词
	if a.taskHook != nil && req.SystemPrompt == "" {
		if prompt, err := a.taskHook.GetSystemPrompt(ctx, req.Type, req.SubType); err == nil && prompt != "" {
			req.SystemPrompt = prompt
		}
	}

	pt, err := a.repo.Create(ctx, user, req, token, func(pt *db.ProjectTask, m *db.Model, i *db.Image) (*taskflow.VirtualMachine, error) {
		t := pt.Edges.Task
		if t == nil {
			return nil, fmt.Errorf("task edge is nil")
		}

		git := taskflow.Git{
			URL:    pt.RepoURL,
			Branch: pt.Branch,
		}
		if token != "" {
			git.Token = token
		}

		vm, err := a.taskflow.VirtualMachiner().Create(ctx, &taskflow.CreateVirtualMachineReq{
			UserID:   user.ID.String(),
			HostID:   req.HostID,
			HostName: t.ID.String(),
			Git:      git,
			ZipUrl:   req.RepoReq.ZipURL,
			ImageURL: i.Name,
			ProxyURL: "",
			TTL: taskflow.TTL{
				Kind:    TTLType,
				Seconds: req.Resource.Life,
			},
			TaskID: t.ID,
			LLM: taskflow.LLMProviderReq{
				Provider: taskflow.LlmProviderOpenAI,
				ApiKey:   m.APIKey,
				BaseURL:  m.BaseURL,
				Model:    m.Model,
			},
			Cores:  fmt.Sprintf("%d", req.Resource.Core),
			Memory: req.Resource.Memory,
		})
		if err != nil {
			return nil, err
		}

		if vm == nil {
			return nil, fmt.Errorf("vm is nil")
		}

		if req.Resource.Life > 0 {
			if _, err := a.vmexpireQueue.Enqueue(ctx, consts.VM_EXPIRE_QUEUE_KEY, &domain.VmExpireInfo{
				UID:    user.ID,
				VmID:   vm.ID,
				HostID: req.HostID,
				EnvID:  vm.EnvironmentID,
			}, time.Now().Add(time.Duration(req.Resource.Life)*time.Second), vm.ID); err != nil {
				a.logger.With("error", err, "vm", vm).ErrorContext(ctx, "failed to enqueue countdown vm")
			}
		}

		if err := a.tasker.CreateTask(ctx, t.ID.String(), &domain.TaskSession{
			Task: &taskflow.CreateVirtualMachineReq{
				TaskID:   t.ID,
				UserID:   user.ID.String(),
				HostID:   req.HostID,
				HostName: t.ID.String(),
				LLM: taskflow.LLMProviderReq{
					ApiKey:  m.APIKey,
					BaseURL: m.BaseURL,
					Model:   m.Model,
				},
			},
			User: user,
		}); err != nil {
			return nil, err
		}

		return vm, nil
	})
	if err != nil {
		a.logger.With("error", err, "req", req).ErrorContext(ctx, "failed to create task")
		return nil, err
	}
	a.logger.With("req", req).InfoContext(ctx, "task created")

	result := cvt.From(pt, &domain.ProjectTask{})

	// 通知 TaskHook（如内部项目的 git task 创建等）
	if a.taskHook != nil {
		if err := a.taskHook.OnTaskCreated(ctx, result); err != nil {
			a.logger.WarnContext(ctx, "taskHook.OnTaskCreated failed", "error", err)
		}
	}

	return result, nil
}

// GetPublic implements domain.TaskUsecase.
func (a *TaskUsecase) GetPublic(ctx context.Context, _ *domain.User, id uuid.UUID) (*domain.Task, error) {
	t, err := a.repo.GetByID(ctx, id)
	if err != nil {
		return nil, errcode.ErrNotFound.Wrap(err)
	}

	return cvt.From(t, &domain.Task{}), nil
}

// GitTask implements domain.TaskUsecase.
func (a *TaskUsecase) GitTask(ctx context.Context, id uuid.UUID) (*domain.GitTask, error) {
	if a.taskHook != nil {
		return a.taskHook.GitTask(ctx, id)
	}
	return nil, errcode.ErrNotFound
}
