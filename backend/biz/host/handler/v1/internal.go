package v1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/patrickmn/go-cache"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	etypes "github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// InternalHostHandler 处理 taskflow 回调的 host/VM 相关接口
type InternalHostHandler struct {
	logger        *slog.Logger
	repo          domain.HostRepo
	teamRepo      domain.TeamHostRepo
	redis         *redis.Client
	cache         *cache.Cache
	hook          domain.InternalHook // 可选，由内部项目通过 WithInternalHook 注入
	taskLifecycle *lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]
	hostUsecase   domain.HostUsecase
}

func NewInternalHostHandler(i *do.Injector) (*InternalHostHandler, error) {
	w := do.MustInvoke[*web.Web](i)

	h := &InternalHostHandler{
		logger:        do.MustInvoke[*slog.Logger](i).With("module", "InternalHostHandler"),
		repo:          do.MustInvoke[domain.HostRepo](i),
		teamRepo:      do.MustInvoke[domain.TeamHostRepo](i),
		redis:         do.MustInvoke[*redis.Client](i),
		cache:         cache.New(15*time.Minute, 10*time.Minute),
		taskLifecycle: do.MustInvoke[*lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]](i),
		hostUsecase:   do.MustInvoke[domain.HostUsecase](i),
	}

	// 可选注入 InternalHook
	if hook, err := do.Invoke[domain.InternalHook](i); err == nil {
		h.hook = hook
	}

	g := w.Group("/internal")
	g.POST("/check-token", web.BindHandler(h.CheckToken))
	g.POST("/host-info", web.BindHandler(h.ReportHostInfo))
	g.POST("/vm-info", web.BindHandler(h.ReportVirtualMachine))
	g.POST("/vm-ready", web.BindHandler(h.VmReady))
	g.POST("/vm-conditions", web.BindHandler(h.VmConditions))
	g.POST("/llms", web.BindHandler(h.ListLLM))
	g.POST("/coding-config", web.BindHandler(h.GetCodingConfig))
	g.POST("/git-credential", web.BindHandler(h.GitCredential))
	g.GET("/vm/list", web.BaseHandler(h.VMList))
	g.POST("/vm/activity", web.BindHandler(h.VMActivity))

	return h, nil
}

// ReportHostInfo 上报宿主机信息
func (h *InternalHostHandler) ReportHostInfo(c *web.Context, host taskflow.Host) error {
	if err := h.repo.UpsertHost(context.Background(), &host); err != nil {
		h.logger.ErrorContext(context.Background(), "upsert host failed", "error", err)
		return err
	}
	return c.Success(nil)
}

// ReportVirtualMachine 上报虚拟机信息
func (h *InternalHostHandler) ReportVirtualMachine(c *web.Context, vm taskflow.VirtualMachine) error {
	if err := h.repo.UpsertVirtualMachine(context.Background(), &vm); err != nil {
		h.logger.ErrorContext(context.Background(), "upsert virtual machine failed", "error", err)
		return err
	}
	return c.Success(nil)
}

// ListLLM 列出虚拟机关联的 LLM
func (h *InternalHostHandler) ListLLM(c *web.Context, req taskflow.ListLLMReq) error {
	vm, err := h.repo.GetVirtualMachine(c.Request().Context(), req.VmID)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "get virtual machine failed", "error", err)
		return err
	}

	if vm.HostID != req.HostID {
		h.logger.ErrorContext(c.Request().Context(), "host id mismatch", "vm_host_id", vm.HostID, "req_host_id", req.HostID)
		return errors.New("host id mismatch")
	}

	if m := vm.Edges.Model; m != nil {
		return c.Success([]*taskflow.LLMInfo{
			{
				ApiKey:  m.APIKey,
				BaseURL: m.BaseURL,
				Model:   m.Model,
			},
		})
	}

	return c.Success([]*taskflow.LLMInfo{})
}

// GetCodingConfig 获取编码配置
func (h *InternalHostHandler) GetCodingConfig(c *web.Context, req taskflow.GetCodingConfigReq) error {
	return c.Success(taskflow.CodingConfig{})
}

// VMList 根据 ID 获取虚拟机信息
func (h *InternalHostHandler) VMList(c *web.Context) error {
	id := c.Request().URL.Query().Get("id")
	if id == "" {
		return fmt.Errorf("id parameter is required")
	}

	vm, err := h.repo.GetVirtualMachine(c.Request().Context(), id)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "get virtual machine failed", "id", id, "error", err)
		return err
	}

	result := &taskflow.VirtualMachine{
		ID:        vm.ID,
		HostID:    vm.HostID,
		Hostname:  vm.Hostname,
		OS:        vm.Os,
		Arch:      vm.Arch,
		Cores:     int32(vm.Cores),
		Memory:    uint64(vm.Memory),
		Version:   vm.Version,
		Status:    taskflow.VirtualMachineStatusOffline,
		CreatedAt: vm.CreatedAt.Unix(),
	}

	if vm.EnvironmentID != "" {
		result.EnvironmentID = vm.EnvironmentID
	}

	return c.Success(result)
}

// CheckToken 认证 token
func (h *InternalHostHandler) CheckToken(c *web.Context, req taskflow.CheckTokenReq) error {
	logger := h.logger.With("fn", "CheckToken", "req", req)
	var tk *taskflow.Token
	var err error
	if strings.HasPrefix(req.Token, "agent_") {
		tk, err = h.agentAuth(c.Request().Context(), req.Token, req.MachineID)
	} else {
		tk, err = h.hostAuth(c.Request().Context(), req.Token, req.MachineID)
	}

	if err != nil {
		logger.With("error", err).ErrorContext(c.Request().Context(), "failed to check token")
		return err
	}

	logger.With("token", tk).DebugContext(c.Request().Context(), "check token success")

	return c.Success(tk)
}

func (h *InternalHostHandler) agentAuth(ctx context.Context, token, mid string) (*taskflow.Token, error) {
	// 1) 优先从 Redis 读取一次性 agent token，并清除
	key := fmt.Sprintf("agent:token:%s", token)
	luaGetDel := `
local v = redis.call('GET', KEYS[1])
if v then
	 redis.call('DEL', KEYS[1])
	 return v
end
return nil
`
	res, err := h.redis.Eval(ctx, luaGetDel, []string{key}).Result()
	h.logger.With("mid", mid, "key", key, "res", res, "error", err).DebugContext(ctx, "agent auth...")
	if err == nil {
		if b, ok := res.(string); ok && b != "" {
			var t taskflow.Token
			if uerr := json.Unmarshal([]byte(b), &t); uerr != nil {
				h.logger.With("error", uerr, "token", token).ErrorContext(ctx, "failed to unmarshal token from redis")
				return nil, uerr
			}

			if mid != "" {
				if err := h.repo.UpdateVirtualMachine(ctx, token, func(up *db.VirtualMachineUpdateOne) error {
					up.SetMachineID(mid)
					return nil
				}); err != nil {
					h.logger.With("error", err, "token", token).ErrorContext(ctx, "failed to update virtual machine machine id")
					return nil, err
				}
			}

			return &t, nil
		}
	} else if !errors.Is(err, redis.Nil) {
		h.logger.With("error", err, "token", token).ErrorContext(ctx, "failed to get redis token via lua, fallback to db")
	}

	// 2) Redis 没值时根据数据库校验 token
	vm, err := h.repo.GetVirtualMachine(ctx, token)
	if err != nil {
		return nil, err
	}

	// 机器码绑定校验
	if mid != "" && vm.MachineID != "" && vm.MachineID != mid {
		return nil, fmt.Errorf("mismatch machine id")
	}

	if vm.IsRecycled {
		return nil, fmt.Errorf("vm is recycled")
	}

	if vm.Edges.Host == nil {
		return nil, fmt.Errorf("no host found for vm")
	}

	// 通过 hook 获取关联的 TaskID（内部项目注入时生效）
	taskID := uuid.Nil
	if len(vm.Edges.Tasks) > 0 {
		taskID = vm.Edges.Tasks[0].ID
	}

	return &taskflow.Token{
		Kind: taskflow.AgentToken,
		User: &taskflow.TokenUser{
			ID: vm.UserID.String(),
		},
		ParentToken: vm.HostID,
		Token:       token,
		TaskID:      taskID,
	}, nil
}

func (h *InternalHostHandler) hostAuth(ctx context.Context, token, mid string) (*taskflow.Token, error) {
	// 1) 优先从 Redis 读取一次性 host token，并清除（原子）
	key := fmt.Sprintf("host:token:%s", token)
	luaGetDel := `
local v = redis.call('GET', KEYS[1])
if v then
  redis.call('DEL', KEYS[1])
  return v
end
return nil
`
	res, err := h.redis.Eval(ctx, luaGetDel, []string{key}).Result()
	if err == nil {
		if b, ok := res.(string); ok && b != "" {
			var u domain.User
			if uerr := json.Unmarshal([]byte(b), &u); uerr != nil {
				h.logger.With("error", uerr, "token", token).ErrorContext(ctx, "failed to unmarshal user from redis token")
				return nil, uerr
			}
			h.logger.With("cache result", b, "user", u).DebugContext(ctx, "get result from redis by lua")

			typeUser := &taskflow.TokenUser{
				ID:        u.ID.String(),
				Name:      u.Name,
				AvatarURL: u.AvatarURL,
				Email:     u.Email,
			}
			if u.Team != nil {
				typeUser.Team = &taskflow.TokenTeam{
					ID:   u.Team.ID.String(),
					Name: u.Name,
				}
			}
			tk := &taskflow.Token{
				Kind:  taskflow.OrchestratorToken,
				Token: token,
				User:  typeUser,
			}

			// 持久化宿主机与用户的映射
			if u.Team == nil {
				if err := h.repo.UpsertHost(context.Background(), &taskflow.Host{
					ID:     token,
					UserID: u.ID.String(),
				}); err != nil {
					return nil, err
				}
			} else {
				h.logger.With("team", u.Team, "user", u.ID).DebugContext(ctx, "upsert host to team")
				if err := h.teamRepo.UpsertHost(context.Background(), &u, &taskflow.Host{
					ID:     token,
					UserID: u.ID.String(),
				}); err != nil {
					return nil, err
				}
			}

			return tk, nil
		}
	} else if !errors.Is(err, redis.Nil) {
		h.logger.With("error", err, "token", token).ErrorContext(ctx, "failed to get redis host token via lua, fallback to db")
	}

	// 2) Redis 无值则回退到数据库校验
	host, err := h.repo.GetByID(ctx, token)
	if err != nil {
		return nil, err
	}
	if mid != "" && host.MachineID != "" && mid != host.MachineID {
		return nil, fmt.Errorf("mismatch machine id")
	}

	return &taskflow.Token{
		Kind: taskflow.OrchestratorToken,
		User: &taskflow.TokenUser{
			ID: host.UserID.String(),
		},
		Token: token,
	}, nil
}

// VmReady VM 就绪回调
func (h *InternalHostHandler) VmReady(c *web.Context, req taskflow.VirtualMachine) error {
	h.logger.With("req", req).DebugContext(c.Request().Context(), "recv vm ready req")

	vm, err := h.repo.GetVirtualMachine(c.Request().Context(), req.ID)
	if err != nil {
		return err
	}

	for _, t := range vm.Edges.Tasks {
		h.logger.With("task", t).DebugContext(c.Request().Context(), "vm-ready")

		if t.Kind == consts.TaskTypeReview && t.SubType == consts.TaskSubTypePrReview {
		} else {
			if err := h.taskLifecycle.Transition(c.Request().Context(), t.ID, consts.TaskStatusProcessing, lifecycle.TaskMetadata{
				TaskID: t.ID,
				UserID: t.UserID,
			}); err != nil {
				h.logger.With("task", t, "error", err).ErrorContext(c.Request().Context(), "failed to transition task to processing")
			}
		}

		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if err := h.hostUsecase.RefreshIdleTimers(ctx, vm.ID); err != nil {
				h.logger.With("error", err).ErrorContext(ctx, "failed to refresh idel timers")
			}
		}()

	}

	return c.Success(nil)
}

// VmConditions VM 条件更新回调
func (h *InternalHostHandler) VmConditions(c *web.Context, req taskflow.VirtualMachineCondition) error {
	if len(req.Conditions) == 0 {
		return nil
	}

	last := req.Conditions[len(req.Conditions)-1]

	key := fmt.Sprintf("conditions:%s.%s.%d.%d", req.EnvID, last.Type, last.Status, last.LastTransitionTime)
	if _, ok := h.cache.Get(key); ok {
		h.logger.DebugContext(c.Request().Context(), "hit cached conditions", "key", key)
		return nil
	}

	vm, err := h.repo.GetVirtualMachineByEnvID(c.Request().Context(), req.EnvID)
	if err != nil {
		return err
	}

	// 条件失败时通过 hook 通知内部项目（任务状态转换等）
	if h.hook != nil {
		for _, cond := range req.Conditions {
			if cond.Type == string(etypes.ConditionTypeFailed) {
				if err := h.hook.OnVmConditionFailed(c.Request().Context(), vm.ID); err != nil {
					h.logger.With("error", err).ErrorContext(c.Request().Context(), "hook OnVmConditionFailed failed")
				}
				break
			}
		}
	}

	conds := cvt.From(&req, &etypes.VirtualMachineCondition{})
	h.logger.With("req", req, "conds", conds).DebugContext(c.Request().Context(), "recv vm conditions req")
	if err := h.repo.UpdateVirtualMachine(c.Request().Context(), vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
		vmuo.SetConditions(conds)
		return nil
	}); err != nil {
		h.logger.With("vm", vm, "error", err).ErrorContext(c.Request().Context(), "update vm conditions failed")
		return err
	}

	h.cache.Set(key, true, 15*time.Minute)

	return c.Success(nil)
}

// GitCredential 获取 git 凭证
func (h *InternalHostHandler) GitCredential(c *web.Context, req taskflow.GitCredentialRequest) error {
	if h.hook == nil {
		errMsg := "git credential not supported"
		return c.Success(taskflow.GitCredentialResponse{Error: &errMsg})
	}

	resp, err := h.hook.GitCredential(c.Request().Context(), &req)
	if err != nil {
		errMsg := fmt.Sprintf("failed to get git credential: %v", err)
		return c.Success(taskflow.GitCredentialResponse{Error: &errMsg})
	}
	return c.Success(resp)
}

// VMActivityReq VM 活动上报请求
type VMActivityReq struct {
	VMID         string `json:"vm_id"`
	LastActiveAt int64  `json:"last_active_at"`
}

// VMActivity VM 活动回调，用于刷新空闲计时器
func (h *InternalHostHandler) VMActivity(c *web.Context, req VMActivityReq) error {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := h.hostUsecase.RefreshIdleTimers(ctx, req.VMID); err != nil {
			h.logger.With("error", err).ErrorContext(ctx, "failed to refresh idel timers")
		}
	}()
	return c.Success(nil)
}
