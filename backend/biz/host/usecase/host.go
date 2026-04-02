package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	gituc "github.com/chaitin/MonkeyCode/backend/biz/git/usecase"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/random"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/templates"
)

type HostUsecase struct {
	cfg              *config.Config
	redis            *redis.Client
	taskflow         taskflow.Clienter
	logger           *slog.Logger
	repo             domain.HostRepo
	taskRepo         domain.TaskRepo
	userRepo         domain.UserRepo
	notifyDispatcher *dispatcher.Dispatcher
	vmSleepQueue     *delayqueue.VMSleepQueue
	vmNotifyQueue    *delayqueue.VMNotifyQueue
	vmRecycleQueue   *delayqueue.VMRecycleQueue
	vmexpireQueue    *delayqueue.VMExpireQueue
	privilegeChecker domain.PrivilegeChecker // 可选，由内部项目通过 WithPrivilegeChecker 注入
	tokenProvider    *gituc.TokenProvider
}

func NewHostUsecase(i *do.Injector) (domain.HostUsecase, error) {
	h := &HostUsecase{
		cfg:              do.MustInvoke[*config.Config](i),
		redis:            do.MustInvoke[*redis.Client](i),
		taskflow:         do.MustInvoke[taskflow.Clienter](i),
		logger:           do.MustInvoke[*slog.Logger](i).With("module", "HostUsecase"),
		repo:             do.MustInvoke[domain.HostRepo](i),
		taskRepo:         do.MustInvoke[domain.TaskRepo](i),
		userRepo:         do.MustInvoke[domain.UserRepo](i),
		notifyDispatcher: do.MustInvoke[*dispatcher.Dispatcher](i),
		vmSleepQueue:     do.MustInvoke[*delayqueue.VMSleepQueue](i),
		vmNotifyQueue:    do.MustInvoke[*delayqueue.VMNotifyQueue](i),
		vmRecycleQueue:   do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		vmexpireQueue:    do.MustInvoke[*delayqueue.VMExpireQueue](i),
		tokenProvider:    do.MustInvoke[*gituc.TokenProvider](i),
	}

	// 可选注入 PrivilegeChecker
	if pc, err := do.Invoke[domain.PrivilegeChecker](i); err == nil {
		h.privilegeChecker = pc
	}

	go h.periodicEnqueueVm()
	go h.vmSleepConsumer()
	go h.vmNotifyConsumer()
	go h.vmRecycleConsumer()
	go h.vmexpireConsumer()
	return h, nil
}

const (
	VM_SLEEP_QUEUE_KEY   = "vm:idle:sleep"
	VM_NOTIFY_QUEUE_KEY  = "vm:idle:notify"
	VM_RECYCLE_QUEUE_KEY = "vm:idle:recycle"
	VM_EXPIRE_QUEUE_KEY  = "vm:expire"
	vmRecycleNotifyLead  = time.Hour
)

func (h *HostUsecase) vmIdleSleepDelay() time.Duration {
	return time.Duration(h.cfg.VMIdle.SleepSeconds) * time.Second
}

func (h *HostUsecase) vmIdleRecycleDelay() time.Duration {
	return time.Duration(h.cfg.VMIdle.RecycleSeconds) * time.Second
}

func (h *HostUsecase) vmIdleNotifyDelay() time.Duration {
	recycleDelay := h.vmIdleRecycleDelay()
	if recycleDelay <= vmRecycleNotifyLead {
		return 0
	}
	return recycleDelay - vmRecycleNotifyLead
}

func (h *HostUsecase) vmRecycleNotifyRemaining() time.Duration {
	recycleDelay := h.vmIdleRecycleDelay()
	if recycleDelay <= vmRecycleNotifyLead {
		return recycleDelay
	}
	return vmRecycleNotifyLead
}

func (h *HostUsecase) periodicEnqueueVm() {
	t := time.NewTicker(10 * time.Minute)
	for range t.C {
		vms, err := h.repo.PastHourVirtualMachine(context.Background())
		if err != nil {
			h.logger.With("error", err).Error("failed to list need expire virtualmachine")
			return
		}

		for _, vm := range vms {
			if vm.TTL <= 0 {
				continue
			}

			if _, err := h.vmexpireQueue.Enqueue(context.Background(), VM_EXPIRE_QUEUE_KEY, &domain.VmExpireInfo{
				UID:    vm.UserID,
				VmID:   vm.ID,
				HostID: vm.HostID,
				EnvID:  vm.EnvironmentID,
			}, vm.CreatedAt.Add(time.Duration(vm.TTL)*time.Second), vm.ID); err != nil {
				h.logger.With("error", err, "vm", vm).Error("failed to enqueue vm")
			}
		}
	}
}

func (h *HostUsecase) vmexpireConsumer() {
	logger := h.logger.With("fn", "vmexpireConsumer")
	index := 1
	for {
		err := h.vmexpireQueue.StartConsumer(context.Background(), VM_EXPIRE_QUEUE_KEY, func(ctx context.Context, job *delayqueue.Job[*domain.VmExpireInfo]) error {
			innerLogger := logger.With("job", job)
			innerLogger.InfoContext(ctx, "received expired virtualmachine")

			ctx = entx.SkipSoftDelete(ctx)
			vm, err := h.repo.GetVirtualMachine(ctx, job.Payload.VmID)
			if err != nil {
				innerLogger.ErrorContext(ctx, "failed to get vm", "error", err)
				return nil
			}

			if err := h.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
				UserID: vm.UserID.String(),
				HostID: vm.HostID,
				ID:     vm.EnvironmentID,
			}); err != nil {
				innerLogger.ErrorContext(ctx, "failed to delete vm", "error", err)
			}

			if err := h.repo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
				vmuo.SetIsRecycled(true)
				return nil
			}); err != nil {
				innerLogger.ErrorContext(ctx, "failed to update vm", "error", err)
				return err
			}

			return nil
		})

		h.logger.With("error", err, "index", index).WarnContext(context.Background(), "start consumer error retrying...")
		index++
		time.Sleep(10 * time.Second)
	}
}

func (h *HostUsecase) RefreshIdleTimers(ctx context.Context, vmID string) error {
	vm, err := h.repo.GetVirtualMachine(ctx, vmID)
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to get vm for refresh idle timers", "vmID", vmID, "error", err)
		return fmt.Errorf("get vm %s: %w", vmID, err)
	}

	if len(vm.Edges.Tasks) == 0 {
		h.logger.DebugContext(ctx, "skip idle timer for countdown VM", "vmID", vmID)
		return nil
	}

	payload := &domain.VmIdleInfo{
		UID:    vm.UserID,
		VmID:   vm.ID,
		HostID: vm.HostID,
		EnvID:  vm.EnvironmentID,
	}

	debounceKey := fmt.Sprintf("vm:idle:debounce:%s", vmID)
	ok, err := h.redis.SetNX(ctx, debounceKey, "1", 30*time.Second).Result()
	if err != nil {
		h.logger.ErrorContext(ctx, "redis SetNX failed for idle debounce", "vmID", vmID, "error", err)
		return fmt.Errorf("redis debounce SetNX for vm %s: %w", vmID, err)
	}
	if !ok {
		return nil
	}

	now := time.Now()
	var errs []error
	if _, err := h.vmSleepQueue.Enqueue(ctx, VM_SLEEP_QUEUE_KEY, payload, now.Add(h.vmIdleSleepDelay()), vmID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue sleep", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("enqueue sleep: %w", err))
	}
	if _, err := h.vmNotifyQueue.Enqueue(ctx, VM_NOTIFY_QUEUE_KEY, payload, now.Add(h.vmIdleNotifyDelay()), vmID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue notify", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("enqueue notify: %w", err))
	}
	if _, err := h.vmRecycleQueue.Enqueue(ctx, VM_RECYCLE_QUEUE_KEY, payload, now.Add(h.vmIdleRecycleDelay()), vmID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue recycle", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("enqueue recycle: %w", err))
	}
	return errors.Join(errs...)
}

func (h *HostUsecase) vmSleepConsumer() {
	logger := h.logger.With("fn", "vmSleepConsumer")
	for {
		err := h.vmSleepQueue.StartConsumer(context.Background(), VM_SLEEP_QUEUE_KEY,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm idle sleep triggered", "vmID", job.Payload.VmID)
				vm, err := h.repo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						logger.InfoContext(ctx, "skip sleeping missing vm", "vmID", job.Payload.VmID)
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				if err := h.taskflow.VirtualMachiner().Hibernate(ctx, &taskflow.HibernateVirtualMachineReq{
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

func (h *HostUsecase) vmNotifyConsumer() {
	logger := h.logger.With("fn", "vmNotifyConsumer")
	for {
		err := h.vmNotifyQueue.StartConsumer(context.Background(), VM_NOTIFY_QUEUE_KEY,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm recycle notify triggered", "vmID", job.Payload.VmID)
				vm, err := h.repo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				event, err := h.buildVMRecycleNotifyEvent(ctx, vm, time.Now().Add(h.vmRecycleNotifyRemaining()))
				if err != nil {
					return err
				}
				if event == nil {
					return nil
				}

				return h.notifyDispatcher.Publish(ctx, event)
			})
		logger.Warn("notify consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

func (h *HostUsecase) vmRecycleConsumer() {
	logger := h.logger.With("fn", "vmRecycleConsumer")
	for {
		err := h.vmRecycleQueue.StartConsumer(context.Background(), VM_RECYCLE_QUEUE_KEY,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				innerLogger := logger.With("job", job)
				innerLogger.InfoContext(ctx, "vm recycle triggered")

				ctx = entx.SkipSoftDelete(ctx)
				vm, err := h.repo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						return nil
					}
					innerLogger.ErrorContext(ctx, "failed to get vm", "error", err)
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				if err := h.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
					UserID: vm.UserID.String(),
					HostID: vm.HostID,
					ID:     vm.EnvironmentID,
				}); err != nil {
					innerLogger.ErrorContext(ctx, "failed to delete vm, will retry", "error", err)
					return fmt.Errorf("delete vm %s: %w", vm.ID, err)
				}

				if err := h.repo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
					vmuo.SetIsRecycled(true)
					return nil
				}); err != nil {
					innerLogger.ErrorContext(ctx, "failed to update vm", "error", err)
					return err
				}

				if err := h.markRecycledTasksFinished(ctx, vm); err != nil {
					innerLogger.ErrorContext(ctx, "failed to mark recycled tasks finished", "error", err)
					return err
				}
				return nil
			})
		logger.Warn("recycle consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

// GetInstallCommand implements domain.HostUsecase.
func (h *HostUsecase) GetInstallCommand(ctx context.Context, user *domain.User) (string, error) {
	token := uuid.NewString()
	ub, err := json.Marshal(user)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("host:token:%s", token)
	if err := h.redis.Set(ctx, key, string(ub), 15*time.Minute).Err(); err != nil {
		return "", err
	}

	baseurl, err := url.Parse(h.cfg.Server.BaseURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse baseurl [%s]", h.cfg.Server.BaseURL)
	}
	baseurl = baseurl.JoinPath("/api/v1/users/hosts/install")
	values := url.Values{}
	values.Add("token", token)
	baseurl.RawQuery = values.Encode()

	return fmt.Sprintf(`bash -c "$(curl -fsSL '%s')"`, baseurl.String()), nil
}

// InstallScript implements domain.HostUsecase.
func (h *HostUsecase) InstallScript(ctx context.Context, token *domain.InstallReq) (string, error) {
	key := fmt.Sprintf("host:token:%s", token.Token)
	if _, err := h.redis.Get(ctx, key).Result(); err != nil {
		return "", errcode.ErrInvalidInstallToken
	}

	tmp, err := template.New("install").Parse(string(templates.InstallTmpl))
	if err != nil {
		return "", fmt.Errorf("failed to parse template %s", err)
	}
	buf := bytes.NewBuffer([]byte(""))
	param := map[string]any{
		"token":    token.Token,
		"grpc_url": h.cfg.TaskFlow.GrpcURL,
	}
	if err := tmp.Execute(buf, param); err != nil {
		return "", fmt.Errorf("failed to execute template %s", err)
	}
	return buf.String(), nil
}

// List implements domain.HostUsecase.
func (h *HostUsecase) List(ctx context.Context, uid uuid.UUID) (*domain.HostListResp, error) {
	user, err := h.userRepo.Get(ctx, uid)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}

	hs, err := h.repo.List(ctx, uid)
	if err != nil {
		return &domain.HostListResp{}, err
	}

	m, err := h.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: cvt.Iter(hs, func(_ int, host *db.Host) string {
			return host.ID
		}),
	})
	if err != nil {
		return nil, err
	}
	vmids := make([]string, 0)
	for _, host := range hs {
		for _, vm := range host.Edges.Vms {
			vmids = append(vmids, vm.ID)
		}
	}

	vmonline, err := h.taskflow.VirtualMachiner().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: vmids,
	})
	if err != nil {
		return nil, err
	}

	resp := &domain.HostListResp{}
	for _, host := range hs {
		status := consts.HostStatusOffline
		if m.OnlineMap[host.ID] {
			status = consts.HostStatusOnline
		}
		dHost := cvt.From(host, &domain.Host{Status: status})
		dHost.IsDefault = dHost.GetIsDefault(user)
		dHost.VirtualMachines = cvt.Iter(host.Edges.Vms, func(_ int, vm *db.VirtualMachine) *domain.VirtualMachine {
			status := taskflow.VirtualMachineStatusOffline
			if vmonline.OnlineMap[vm.ID] {
				status = taskflow.VirtualMachineStatusOnline
			}
			return cvt.From(vm, &domain.VirtualMachine{
				Status: status,
			})
		})

		resp.Hosts = append(resp.Hosts, dHost)
	}

	return resp, nil
}

// TerminalList implements domain.HostUsecase.
func (h *HostUsecase) TerminalList(ctx context.Context, id string) ([]*domain.Terminal, error) {
	ts, err := h.taskflow.VirtualMachiner().TerminalList(ctx, id)
	if err != nil {
		return nil, err
	}
	return cvt.Iter(ts, func(_ int, t *taskflow.Terminal) *domain.Terminal {
		return cvt.From(t, &domain.Terminal{})
	}), nil
}

// CloseTerminal implements domain.HostUsecase.
func (h *HostUsecase) CloseTerminal(ctx context.Context, id string, terminalID string) error {
	return h.taskflow.VirtualMachiner().CloseTerminal(ctx, &taskflow.CloseTerminalReq{
		ID:         id,
		TerminalID: terminalID,
	})
}

// ConnectVMTerminal 连接到虚拟机终端
func (h *HostUsecase) ConnectVMTerminal(ctx context.Context, uid uuid.UUID, req domain.TerminalReq) (taskflow.Sheller, error) {
	return h.taskflow.VirtualMachiner().Terminal(ctx, &taskflow.TerminalReq{
		ID:         req.ID,
		TerminalID: req.TerminalID,
		Exec:       req.Exec,
		TerminalSize: taskflow.TerminalSize{
			Col: uint32(req.Col),
			Row: uint32(req.Row),
		},
	})
}

// isPrivileged 检查用户是否为特权用户（仅在注入 PrivilegeChecker 时生效）
func (h *HostUsecase) isPrivileged(ctx context.Context, uid uuid.UUID) bool {
	if h.privilegeChecker == nil {
		return false
	}
	ok, err := h.privilegeChecker.IsPrivileged(ctx, uid)
	if err != nil {
		h.logger.ErrorContext(ctx, "failed to check privilege", "error", err, "uid", uid)
		return false
	}
	return ok
}

// WithVMPermission implements domain.HostUsecase.
func (h *HostUsecase) WithVMPermission(ctx context.Context, uid uuid.UUID, id string, fn func(*domain.VirtualMachine) error) error {
	var (
		vm  *db.VirtualMachine
		err error
	)

	if h.isPrivileged(ctx, uid) {
		vm, err = h.repo.GetVirtualMachine(ctx, id)
	} else {
		vm, err = h.repo.GetVirtualMachineWithUser(ctx, uid, id)
	}
	if err != nil {
		return err
	}

	return fn(cvt.From(vm, &domain.VirtualMachine{}))
}

// CreateVM 创建虚拟机
func (h *HostUsecase) CreateVM(ctx context.Context, user *domain.User, req *domain.CreateVMReq) (*domain.VirtualMachine, error) {
	resp, err := h.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: []string{req.HostID},
	})
	if err != nil {
		return nil, errcode.ErrHostOffline.Wrap(err)
	}
	if !resp.OnlineMap[req.HostID] {
		return nil, errcode.ErrHostOffline
	}

	req.Now = time.Now()
	vm, err := h.repo.CreateVirtualMachine(ctx, user, req, nil, func(model *db.Model, image *db.Image) (*domain.VirtualMachine, error) {
		kind := taskflow.TTLCountDown
		if req.Life == 0 {
			kind = taskflow.TTLForever
		}

		h.logger.InfoContext(ctx, "create vm", "req", req, "kind", kind, "seconds", req.Life)

		temperature := new(float32)
		var LLMConfig taskflow.LLMProviderReq
		if model != nil {
			LLMConfig = taskflow.LLMProviderReq{
				Provider:    taskflow.LlmProviderOpenAI,
				ApiKey:      model.APIKey,
				Model:       model.Model,
				Temperature: temperature,
				BaseURL:     model.BaseURL,
			}
		}

		repoURL := ""
		branch := ""
		zipURL := ""
		if req.RepoReq != nil {
			repoURL = req.RepoReq.RepoURL
			branch = req.RepoReq.Branch
			zipURL = req.RepoReq.ZipURL
		}

		git := taskflow.Git{
			URL:    repoURL,
			Branch: branch,
		}
		if req.GitIdentityID != uuid.Nil {
			t, err := h.tokenProvider.GetToken(ctx, req.GitIdentityID)
			if err != nil {
				return nil, fmt.Errorf("get git token: %w", err)
			}
			git.Token = t
		}

		tfvm, err := h.taskflow.VirtualMachiner().Create(
			ctx,
			&taskflow.CreateVirtualMachineReq{
				UserID:              user.ID.String(),
				HostID:              req.HostID,
				Git:                 git,
				ZipUrl:              zipURL,
				ProxyURL:            "",
				ImageURL:            image.Name,
				LLM:                 LLMConfig,
				Cores:               strconv.Itoa(req.Resource.CPU),
				Memory:              uint64(req.Resource.Memory),
				InstallCodingAgents: req.InstallCodingAgents,
			})
		if err != nil {
			h.logger.ErrorContext(ctx, "failed to create vm", "error", err)
			return nil, err
		}
		if tfvm == nil {
			return nil, fmt.Errorf("failed to create vm, vm is nil")
		}

		h.logger.InfoContext(ctx, "create vm success", "vm", tfvm)

		// 手动创建的 VM 使用 TTL 过期逻辑，任务创建的 VM 使用空闲检测逻辑
		// 通过 Life 参数区分：Life > 0 为手动创建的 VM，使用 TTL 过期逻辑
		if req.Life > 0 {
			if _, err := h.vmexpireQueue.Enqueue(ctx, VM_EXPIRE_QUEUE_KEY, &domain.VmExpireInfo{
				UID:    user.ID,
				VmID:   tfvm.ID,
				HostID: req.HostID,
				EnvID:  tfvm.EnvironmentID,
			}, time.Now().Add(time.Duration(req.Life)*time.Second), tfvm.ID); err != nil {
				h.logger.With("error", err, "vm", tfvm).ErrorContext(ctx, "failed to enqueue countdown vm")
			}
		}

		return &domain.VirtualMachine{
			ID:            tfvm.ID,
			EnvironmentID: tfvm.EnvironmentID,
			Name:          req.Name,
			Host: &domain.Host{
				ID: req.HostID,
			},
			LifeTimeSeconds: req.Life,
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if vm == nil {
		return nil, fmt.Errorf("failed to create vm")
	}

	return vm, nil
}

// DeleteVM 删除虚拟机
func (h *HostUsecase) DeleteVM(ctx context.Context, uid uuid.UUID, hostID, vmID string) error {
	h.logger.InfoContext(ctx, "delete vm", "vmID", vmID)
	return h.repo.DeleteVirtualMachine(ctx, uid, hostID, vmID, func(vm *db.VirtualMachine) error {
		if err := h.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
			UserID: uid.String(),
			HostID: vm.HostID,
			ID:     vm.EnvironmentID,
		}); err != nil {
			h.logger.ErrorContext(ctx, "failed to delete vm", "error", err)
		}

		// 清理延迟队列中的残留任务（空闲检测队列 + TTL 过期队列）
		_ = h.vmSleepQueue.Remove(ctx, VM_SLEEP_QUEUE_KEY, vm.ID)
		_ = h.vmNotifyQueue.Remove(ctx, VM_NOTIFY_QUEUE_KEY, vm.ID)
		_ = h.vmRecycleQueue.Remove(ctx, VM_RECYCLE_QUEUE_KEY, vm.ID)
		_ = h.vmexpireQueue.Remove(ctx, VM_EXPIRE_QUEUE_KEY, vm.ID)

		return nil
	})
}

// VMInfo implements domain.HostUsecase.
func (h *HostUsecase) VMInfo(ctx context.Context, uid uuid.UUID, id string) (*domain.VirtualMachine, error) {
	var (
		vm  *db.VirtualMachine
		err error
	)

	if h.isPrivileged(ctx, uid) {
		vm, err = h.repo.GetVirtualMachine(ctx, id)
	} else {
		vm, err = h.repo.GetVirtualMachineWithUser(ctx, uid, id)
	}
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}

	vmonline, err := h.taskflow.VirtualMachiner().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: []string{vm.ID},
	})
	if err != nil {
		return nil, err
	}

	m, err := h.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: []string{vm.HostID},
	})
	if err != nil {
		return nil, err
	}

	status := taskflow.VirtualMachineStatusOffline
	if info, err := h.taskflow.VirtualMachiner().Info(ctx, taskflow.VirtualMachineInfoReq{
		ID:     vm.ID,
		UserID: vm.UserID.String(),
	}); err == nil && info != nil && info.Status != taskflow.VirtualMachineStatusUnknown {
		status = info.Status
	} else if vmonline.OnlineMap[vm.ID] {
		status = taskflow.VirtualMachineStatusOnline
	}
	dvm := cvt.From(vm, &domain.VirtualMachine{
		Status: status,
	})

	if dvm.Host != nil {
		dvm.Host.Status = consts.HostStatusOffline
		if m.OnlineMap[dvm.Host.ID] {
			dvm.Host.Status = consts.HostStatusOnline
		}
	}

	return dvm, nil
}

// DeleteHost implements domain.HostUsecase.
func (h *HostUsecase) DeleteHost(ctx context.Context, uid uuid.UUID, id string) error {
	return h.repo.DeleteHost(ctx, uid, id)
}

// JoinTerminal implements domain.HostUsecase.
func (h *HostUsecase) JoinTerminal(ctx context.Context, req *domain.JoinTerminalReq) (taskflow.Sheller, *domain.SharedTerminal, error) {
	b, err := h.redis.Get(ctx, req.Password).Result()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get password from redis %s", err)
	}
	var shared domain.SharedTerminal
	if err := json.Unmarshal([]byte(b), &shared); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal share terminal req %s", err)
	}
	if shared.TerminalID != req.TerminalID {
		return nil, nil, fmt.Errorf("terminal id mismatch %s", err)
	}

	mode := taskflow.TerminalModeReadWrite
	if shared.Mode == consts.TerminalModeReadOnly {
		mode = taskflow.TerminalModeReadOnly
	}

	shell, err := h.taskflow.VirtualMachiner().Terminal(ctx, &taskflow.TerminalReq{
		ID:         shared.ID,
		TerminalID: shared.TerminalID,
		Mode:       mode,
		TerminalSize: taskflow.TerminalSize{
			Col: uint32(req.Col),
			Row: uint32(req.Row),
		},
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create shell %s", err)
	}

	return shell, &shared, nil
}

// ShareTerminal implements domain.HostUsecase.
func (h *HostUsecase) ShareTerminal(ctx context.Context, user *domain.User, req *domain.ShareTerminalReq) (*domain.ShareTerminalResp, error) {
	b, err := json.Marshal(&domain.SharedTerminal{
		ID:         req.ID,
		Mode:       req.Mode,
		TerminalID: req.TerminalID,
		User:       user,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal share terminal req %s", err)
	}
	pwd := random.String(8)

	if err := h.redis.Set(ctx, pwd, string(b), 5*time.Minute).Err(); err != nil {
		return nil, fmt.Errorf("failed to set redis %s", err)
	}
	return &domain.ShareTerminalResp{
		Password: pwd,
	}, nil
}

// UpdateHost implements domain.HostUsecase.
func (h *HostUsecase) UpdateHost(ctx context.Context, uid uuid.UUID, req *domain.UpdateHostReq) error {
	return h.repo.UpdateHost(ctx, uid, req)
}

// FireExpiredVM implements domain.HostUsecase.
func (h *HostUsecase) FireExpiredVM(ctx context.Context, fire bool) ([]domain.FireExpiredVMItem, error) {
	vms, err := h.repo.AllCountDownVirtualMachine(ctx)
	if err != nil {
		return nil, err
	}

	vmonline, err := h.taskflow.VirtualMachiner().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: cvt.Iter(vms, func(_ int, vm *db.VirtualMachine) string { return vm.ID }),
	})
	if err != nil {
		return nil, err
	}

	res := make([]domain.FireExpiredVMItem, 0)
	for _, vm := range vms {
		if vm.TTL <= 0 {
			continue
		}

		if !vmonline.OnlineMap[vm.ID] {
			continue
		}

		if vm.CreatedAt.Add(time.Duration(vm.TTL) * time.Second).Before(time.Now()) {
			item := domain.FireExpiredVMItem{
				ID:      vm.ID,
				Message: "checked",
			}
			if fire {
				if _, err := h.vmexpireQueue.Enqueue(context.Background(), VM_EXPIRE_QUEUE_KEY, &domain.VmExpireInfo{
					UID:    vm.UserID,
					VmID:   vm.ID,
					HostID: vm.HostID,
					EnvID:  vm.EnvironmentID,
				}, vm.CreatedAt.Add(time.Duration(vm.TTL)*time.Second), vm.ID); err != nil {
					h.logger.With("error", err, "vm", vm).Error("failed to enqueue vm")
					item.Message = err.Error()
				} else {
					h.logger.With("vm", vm).Info("enqueued vm")
					item.Message = "enqueued"
				}
			}
			res = append(res, item)
		}
	}
	return res, nil
}

// EnqueueAllCountDownVM implements domain.HostUsecase.
func (h *HostUsecase) EnqueueAllCountDownVM(ctx context.Context) ([]string, error) {
	vms, err := h.repo.AllCountDownVirtualMachine(ctx)
	if err != nil {
		return nil, err
	}

	res := make([]string, 0)

	for _, vm := range vms {
		if vm.TTL <= 0 {
			continue
		}

		if _, err := h.vmexpireQueue.Enqueue(context.Background(), VM_EXPIRE_QUEUE_KEY, &domain.VmExpireInfo{
			UID:    vm.UserID,
			VmID:   vm.ID,
			HostID: vm.HostID,
			EnvID:  vm.EnvironmentID,
		}, vm.CreatedAt.Add(time.Duration(vm.TTL)*time.Second), vm.ID); err != nil {
			h.logger.With("error", err, "vm", vm).Error("failed to enqueue vm")
		} else {
			h.logger.With("vm", vm).Info("enqueued vm")
			res = append(res, vm.ID)
		}
	}
	return res, nil
}

// UpdateVM implements domain.HostUsecase.
func (h *HostUsecase) UpdateVM(ctx context.Context, req domain.UpdateVMReq) (*domain.VirtualMachine, error) {
	vm, _, err := h.repo.UpdateVM(ctx, req, func(vm *db.VirtualMachine) error {
		newExpiresAt := vm.CreatedAt.Add(time.Duration(vm.TTL) * time.Second)

		// 更新回收队列（仅针对 CountDown 类型的 VM）
		if vm.TTLKind == consts.CountDown {
			if _, err := h.vmexpireQueue.Enqueue(ctx, VM_EXPIRE_QUEUE_KEY, &domain.VmExpireInfo{
				UID:    vm.UserID,
				VmID:   vm.ID,
				HostID: vm.HostID,
				EnvID:  vm.EnvironmentID,
			}, newExpiresAt, vm.ID); err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	res := cvt.From(vm, &domain.VirtualMachine{})

	return res, nil
}

// ApplyPort implements domain.HostUsecase.
func (h *HostUsecase) ApplyPort(ctx context.Context, uid uuid.UUID, req *domain.ApplyPortReq) (*domain.VMPort, error) {
	if req.ForwardID == "" {
		forwardInfo, err := h.taskflow.PortForwarder().Create(
			ctx,
			taskflow.CreatePortForward{
				ID:           req.ID,
				UserID:       uid.String(),
				LocalPort:    int32(req.Port),
				WhitelistIPs: req.WhiteList,
			},
		)
		if err != nil {
			return nil, err
		}
		return &domain.VMPort{
			ForwardID:    forwardInfo.ForwardID,
			Port:         uint16(forwardInfo.Port),
			Status:       consts.PortStatus(forwardInfo.Status),
			WhiteList:    forwardInfo.WhitelistIPs,
			PreviewURL:   forwardInfo.AccessURL,
			Success:      &forwardInfo.Success,
			ErrorMessage: forwardInfo.ErrorMessage,
		}, nil
	}

	forwardInfo, err := h.taskflow.PortForwarder().Update(
		ctx,
		taskflow.UpdatePortForward{
			ID:           req.ID,
			ForwardID:    req.ForwardID,
			WhitelistIPs: req.WhiteList,
		},
	)
	if err != nil {
		return nil, err
	}
	return &domain.VMPort{
		ForwardID:    forwardInfo.ForwardID,
		PreviewURL:   forwardInfo.AccessURL,
		Port:         uint16(forwardInfo.Port),
		Status:       consts.PortStatus(forwardInfo.Status),
		WhiteList:    forwardInfo.WhitelistIPs,
		Success:      &forwardInfo.Success,
		ErrorMessage: forwardInfo.ErrorMessage,
	}, nil
}

// RecyclePort implements domain.HostUsecase.
func (h *HostUsecase) RecyclePort(ctx context.Context, uid uuid.UUID, req *domain.RecyclePortReq) error {
	return h.taskflow.PortForwarder().Close(ctx, taskflow.ClosePortForward{
		ID:        req.ID,
		ForwardID: req.ForwardID,
	})
}

func (h *HostUsecase) markRecycledTasksFinished(ctx context.Context, vm *db.VirtualMachine) error {
	var errs []error
	for _, tk := range vm.Edges.Tasks {
		if tk == nil {
			continue
		}
		if tk.Status == consts.TaskStatusFinished || tk.Status == consts.TaskStatusError {
			continue
		}
		err := h.taskRepo.Update(ctx, nil, tk.ID, func(up *db.TaskUpdateOne) error {
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

func (h *HostUsecase) buildVMRecycleNotifyEvent(ctx context.Context, vm *db.VirtualMachine, expiresAt time.Time) (*domain.NotifyEvent, error) {
	if len(vm.Edges.Tasks) == 0 || vm.Edges.Tasks[0] == nil {
		return nil, nil
	}

	tk, err := h.taskRepo.GetByID(ctx, vm.Edges.Tasks[0].ID)
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
			TaskURL:     strings.TrimRight(h.cfg.Server.BaseURL, "/") + "/console/task/" + tk.ID.String(),
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

// GetPorts 获取虚拟机端口列表
func (h *HostUsecase) ListPorts(ctx context.Context, uid uuid.UUID, vid string) ([]*domain.VMPort, error) {
	if _, err := h.repo.GetVirtualMachineWithUser(ctx, uid, vid); err != nil {
		return nil, err
	}

	resp, err := h.taskflow.PortForwarder().List(ctx, taskflow.ListPortforwadReq{
		ID:        vid,
		RequestId: uuid.NewString(),
	})
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return []*domain.VMPort{}, nil
	}
	ports := cvt.Iter(resp.Ports, func(_ int, forwardInfo *taskflow.PortForwardInfo) *domain.VMPort {
		vm := &domain.VMPort{
			Port:         uint16(forwardInfo.Port),
			Status:       consts.PortStatus(forwardInfo.Status),
			WhiteList:    forwardInfo.WhitelistIPs,
			ErrorMessage: forwardInfo.ErrorMessage,
			ForwardID:    forwardInfo.ForwardID,
			PreviewURL:   forwardInfo.AccessURL,
		}
		return vm
	})
	sort.Slice(ports, func(i, j int) bool {
		return ports[i].Port < ports[j].Port
	})
	return ports, nil
}
