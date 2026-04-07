package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"net/url"
	"sort"
	"strconv"
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
	userRepo         domain.UserRepo
	girepo           domain.GitIdentityRepo
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
		userRepo:         do.MustInvoke[domain.UserRepo](i),
		girepo:           do.MustInvoke[domain.GitIdentityRepo](i),
		vmexpireQueue:    do.MustInvoke[*delayqueue.VMExpireQueue](i),
		tokenProvider:    do.MustInvoke[*gituc.TokenProvider](i),
	}

	// 可选注入 PrivilegeChecker
	if pc, err := do.Invoke[domain.PrivilegeChecker](i); err == nil {
		h.privilegeChecker = pc
	}

	go h.periodicEnqueueVm()
	go h.vmexpireConsumer()
	return h, nil
}

const (
	VM_EXPIRE_QUEUE_KEY = "vm:expire"
)

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
		if model != nil {
			if keys := model.Edges.Apikeys; len(keys) > 0 {
				model.APIKey = keys[0].APIKey
				model.BaseURL = h.cfg.LLMProxy.BaseURL + "/v1"
			}
		}
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
			identity, err := h.girepo.Get(ctx, req.GitIdentityID)
			if err != nil {
				return nil, fmt.Errorf("get git identity: %w", err)
			}
			t, err := h.tokenProvider.GetToken(ctx, req.GitIdentityID)
			if err != nil {
				return nil, fmt.Errorf("get git token: %w", err)
			}
			git.Token = t
			git.Username = identity.Username
			git.Email = identity.Email
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

		// 清理 TTL 过期队列中的残留任务
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
