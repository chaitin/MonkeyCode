package usecase

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/gogo/protobuf/proto"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	gituc "github.com/chaitin/MonkeyCode/backend/biz/git/usecase"
	"github.com/chaitin/MonkeyCode/backend/biz/task/service"
	vmidle "github.com/chaitin/MonkeyCode/backend/biz/vmidle/usecase"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/vmstatus"
	"github.com/chaitin/MonkeyCode/backend/templates"
)

// TaskUsecase 任务业务逻辑实现
type TaskUsecase struct {
	cfg                   *config.Config
	repo                  domain.TaskRepo
	modelRepo             domain.ModelRepo
	logger                *slog.Logger
	taskflow              taskflow.Clienter
	loki                  *loki.Client
	redis                 *redis.Client
	notifyDispatcher      *dispatcher.Dispatcher
	taskHook              domain.TaskHook
	privilegeChecker      domain.PrivilegeChecker
	modelHook             domain.ModelHook
	taskLifecycle         *lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]
	vmLifecycle           *lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata]
	girepo                domain.GitIdentityRepo
	tokenProvider         *gituc.TokenProvider
	projectRepo           domain.ProjectRepo
	taskActivityRefresher service.TaskActivityRefresher
	idleRefresher         vmidle.VMIdleRefresher
}

// NewTaskUsecase 创建任务业务逻辑实例
func NewTaskUsecase(i *do.Injector) (domain.TaskUsecase, error) {
	u := &TaskUsecase{
		cfg:                   do.MustInvoke[*config.Config](i),
		repo:                  do.MustInvoke[domain.TaskRepo](i),
		modelRepo:             do.MustInvoke[domain.ModelRepo](i),
		logger:                do.MustInvoke[*slog.Logger](i).With("module", "usecase.TaskUsecase"),
		taskflow:              do.MustInvoke[taskflow.Clienter](i),
		loki:                  do.MustInvoke[*loki.Client](i),
		redis:                 do.MustInvoke[*redis.Client](i),
		notifyDispatcher:      do.MustInvoke[*dispatcher.Dispatcher](i),
		taskLifecycle:         do.MustInvoke[*lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]](i),
		vmLifecycle:           do.MustInvoke[*lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata]](i),
		girepo:                do.MustInvoke[domain.GitIdentityRepo](i),
		tokenProvider:         do.MustInvoke[*gituc.TokenProvider](i),
		projectRepo:           do.MustInvoke[domain.ProjectRepo](i),
		taskActivityRefresher: do.MustInvoke[service.TaskActivityRefresher](i),
		idleRefresher:         do.MustInvoke[vmidle.VMIdleRefresher](i),
	}

	// 可选注入 TaskHook
	if hook, err := do.Invoke[domain.TaskHook](i); err == nil {
		u.taskHook = hook
	}

	// 可选注入 PrivilegeChecker
	if pc, err := do.Invoke[domain.PrivilegeChecker](i); err == nil {
		u.privilegeChecker = pc
	}

	// 可选注入 ModelHook
	if hook, err := do.Invoke[domain.ModelHook](i); err == nil {
		u.modelHook = hook
	}

	return u, nil
}

// isPrivileged 检查用户是否为特权用户（仅在注入 PrivilegeChecker 时生效）
func (a *TaskUsecase) isPrivileged(ctx context.Context, uid uuid.UUID) bool {
	if a.privilegeChecker == nil {
		return false
	}
	ok, err := a.privilegeChecker.IsPrivileged(ctx, uid)
	if err != nil {
		a.logger.ErrorContext(ctx, "failed to check privilege", "error", err, "uid", uid)
		return false
	}
	return ok
}

// AutoApprove implements domain.TaskUsecase.
func (a *TaskUsecase) AutoApprove(ctx context.Context, _ *domain.User, id uuid.UUID, approve bool) error {
	return a.taskflow.TaskManager().AutoApprove(ctx, taskflow.TaskApproveReq{
		ID:          id,
		AutoApprove: &approve,
	})
}

// SwitchModel 切换运行中任务使用的模型
func (a *TaskUsecase) SwitchModel(ctx context.Context, user *domain.User, taskID uuid.UUID, req domain.SwitchTaskModelReq) (*domain.SwitchTaskModelResp, error) {
	t, owner, err := a.Info(ctx, user, taskID)
	if err != nil {
		return nil, err
	}
	if !owner && !a.isPrivileged(ctx, user.ID) {
		return nil, errcode.ErrForbidden
	}
	if t.Status != consts.TaskStatusProcessing {
		return nil, fmt.Errorf("task is not processing")
	}
	if t.VirtualMachine == nil {
		return nil, fmt.Errorf("task virtual machine is nil")
	}

	if a.modelHook != nil {
		if err := a.modelHook.ValidateAccess(ctx, user.ID, req.ModelID.String()); err != nil {
			return nil, err
		}
	}
	model, err := a.modelRepo.Get(ctx, user.ID, req.ModelID)
	if err != nil {
		return nil, err
	}
	runtimeKey, err := a.modelRepo.CreateRuntimeAPIKey(ctx, user.ID, req.ModelID, t.VirtualMachine.ID)
	if err != nil {
		return nil, err
	}
	if runtimeKey != "" {
		model.APIKey = runtimeKey
		if a.cfg != nil {
			model.BaseURL = a.cfg.LLMProxy.BaseURL + "/v1"
		}

		if a.redis != nil {
			if err := a.redis.Del(ctx, consts.PublicModelKey(runtimeKey)).Err(); err != nil {
				return nil, fmt.Errorf("delete model cache: %w", err)
			}
		}
	}

	coding, configs, err := a.getCodingConfigs(t.CliName, model, nil)
	if err != nil {
		return nil, err
	}
	if coding != taskflow.CodingAgentOpenCode {
		return nil, fmt.Errorf("switch model only supports opencode runtime")
	}

	envs := map[string]string{
		"OPENAI_API_KEY":                   model.APIKey,
		"OPEN_CODE_API_KEY":                model.APIKey,
		"OPENCODE_DISABLE_DEFAULT_PLUGINS": "1",
		"OPENCODE_DISABLE_LSP_DOWNLOAD":    "true",
	}
	if model.InterfaceType != "" {
		envs["MCAI_MODEL_PROVIDER_TYPE"] = model.InterfaceType
	}

	var fromModelID *uuid.UUID
	if t.Model != nil && t.Model.ID != uuid.Nil {
		id := t.Model.ID
		fromModelID = &id
	}
	item := &domain.TaskModelSwitch{
		ID:          uuid.New(),
		TaskID:      taskID,
		UserID:      user.ID,
		FromModelID: fromModelID,
		ToModelID:   req.ModelID,
		RequestID:   req.RequestID,
		LoadSession: req.LoadSession,
	}
	if err := a.repo.CreateModelSwitch(ctx, item); err != nil {
		return nil, err
	}

	resp, err := a.taskflow.TaskManager().Restart(ctx, taskflow.RestartTaskReq{
		ID:          taskID,
		RequestId:   req.RequestID,
		LoadSession: req.LoadSession,
		LogStore:    string(t.LogStore),
		ExecutionConfig: &taskflow.TaskExecutionConfig{
			Envs:        envs,
			ConfigFiles: configs,
		},
	})
	if err != nil {
		if finishErr := a.repo.FinishModelSwitch(ctx, item.ID, false, err.Error(), ""); finishErr != nil {
			a.logger.WarnContext(ctx, "failed to finish model switch after restart error", "error", finishErr, "switch_id", item.ID)
		}
		return nil, err
	}
	if resp == nil {
		resp = &taskflow.RestartTaskResp{
			RequestId: req.RequestID,
			Success:   false,
			Message:   "taskflow restart response is nil",
		}
	}

	if err := a.repo.CompleteModelSwitch(ctx, item.ID, taskID, req.ModelID, resp.Success, resp.Message, resp.SessionID); err != nil {
		a.logger.ErrorContext(ctx, "failed to persist model switch after restart", "error", err, "switch_id", item.ID, "task_id", taskID)
		if resp.Success {
			resp.Message = strings.TrimSpace(resp.Message + "; persist model switch failed: " + err.Error())
			if finishErr := a.repo.FinishModelSwitch(ctx, item.ID, true, resp.Message, resp.SessionID); finishErr != nil {
				a.logger.WarnContext(ctx, "failed to finish model switch after persistence error", "error", finishErr, "switch_id", item.ID)
			}
		} else {
			if finishErr := a.repo.FinishModelSwitch(ctx, item.ID, false, resp.Message, resp.SessionID); finishErr != nil {
				a.logger.WarnContext(ctx, "failed to finish failed model switch", "error", finishErr, "switch_id", item.ID)
			}
		}
	}

	respModel := cvt.From(model, &domain.ModelBrief{})
	return &domain.SwitchTaskModelResp{
		ID:        item.ID,
		RequestID: resp.RequestId,
		Success:   resp.Success,
		Message:   resp.Message,
		SessionID: resp.SessionID,
		Model:     respModel,
	}, nil
}

// Info implements domain.TaskUsecase.
func (a *TaskUsecase) Info(ctx context.Context, user *domain.User, id uuid.UUID) (*domain.Task, bool, error) {
	ctx = entx.SkipSoftDelete(ctx)

	t, err := a.repo.Info(ctx, user, id, a.isPrivileged(ctx, user.ID))
	if err != nil {
		return nil, false, err
	}

	owner := user.ID == t.UserID

	tk := cvt.From(t, &domain.Task{})
	if vm := tk.VirtualMachine; vm != nil {
		resp, _ := a.taskflow.VirtualMachiner().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
			IDs: []string{vm.ID},
		})
		a.logger.With("resp", resp, "id", vm.ID).DebugContext(ctx, "is online check")
		vm.Status = vmstatus.Resolve(vmstatus.Input{
			Online:     resp != nil && resp.OnlineMap[vm.ID],
			Conditions: vm.Conditions,
			CreatedAt:  time.Unix(vm.CreatedAt, 0),
			Now:        time.Now(),
		})
	}

	if stat, err := a.repo.Stat(ctx, id); err == nil {
		tk.Stats = stat
	}

	return tk, owner, nil
}

// List implements domain.TaskUsecase.
func (a *TaskUsecase) List(ctx context.Context, user *domain.User, req domain.TaskListReq) (*domain.ListTaskResp, error) {
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
		tk := cvt.From(t, &domain.Task{})

		// 通过 lifecycle 回收 VM
		if vm := tk.VirtualMachine; vm != nil {
			if err := a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStateRecycled, lifecycle.VMMetadata{
				VMID:   vm.ID,
				TaskID: &id,
				UserID: user.ID,
			}); err != nil {
				a.logger.WarnContext(ctx, "vm recycle transition failed", "error", err, "vm_id", vm.ID)
			}
		}

		return nil
	})
}

// Cancel implements domain.TaskUsecase.
func (a *TaskUsecase) Cancel(ctx context.Context, user *domain.User, id uuid.UUID) error {
	t, err := a.repo.Info(ctx, user, id, false)
	if err != nil {
		return err
	}
	tk := cvt.From(t, &domain.Task{})

	if err := a.taskflow.TaskManager().Cancel(ctx, taskflow.TaskReq{
		VirtualMachine: &taskflow.VirtualMachine{
			ID:            tk.VirtualMachine.ID,
			HostID:        tk.VirtualMachine.Host.InternalID,
			EnvironmentID: tk.VirtualMachine.EnvironmentID,
		},
		Task: &taskflow.Task{
			ID:       id,
			LogStore: string(tk.LogStore),
		},
	}); err != nil {
		return err
	}

	return nil
}

// Continue implements domain.TaskUsecase.
func (a *TaskUsecase) Continue(ctx context.Context, user *domain.User, id uuid.UUID, req domain.ContinueTaskReq) error {
	if strings.TrimSpace(string(req.Content)) == "" {
		return errcode.ErrBadRequest
	}
	if err := validateAttachments(req.Attachments, a.cfg.Attachment); err != nil {
		return err
	}
	t, err := a.repo.Info(ctx, user, id, false)
	if err != nil {
		return err
	}
	tk := cvt.From(t, &domain.Task{})
	if err := a.taskflow.TaskManager().Continue(ctx, taskflow.TaskReq{
		VirtualMachine: &taskflow.VirtualMachine{
			ID:            tk.VirtualMachine.ID,
			HostID:        tk.VirtualMachine.Host.InternalID,
			EnvironmentID: tk.VirtualMachine.EnvironmentID,
		},
		Task: &taskflow.Task{
			ID:          id,
			Text:        string(req.Content),
			Attachments: taskAttachmentsToTaskflow(req.Attachments),
			LogStore:    string(tk.LogStore),
		},
	}); err != nil {
		return err
	}

	// 缓存最近一次 user-input，供通知推送使用
	a.redis.Set(ctx, fmt.Sprintf("mcai:task:%s:last_input", id.String()), string(req.Content), 24*time.Hour)

	return nil
}

// IncrUserInputCount 记录用户输入次数到 Redis Hash，并按天计数
func (a *TaskUsecase) IncrUserInputCount(ctx context.Context, userID, taskID uuid.UUID) error {
	// 按 task 维度计数（总量，不设过期）
	key := fmt.Sprintf("mcai:user:%s:input_count", userID.String())
	if err := a.redis.HIncrBy(ctx, key, taskID.String(), 1).Err(); err != nil {
		return err
	}

	// 按天计数（用于时间范围统计，90 天过期）
	dailyKey := fmt.Sprintf("mcai:user:%s:input_daily:%s", userID.String(), time.Now().Format("2006-01-02"))
	pipe := a.redis.Pipeline()
	pipe.Incr(ctx, dailyKey)
	pipe.Expire(ctx, dailyKey, 90*24*time.Hour)
	_, err := pipe.Exec(ctx)
	return err
}

// Create implements domain.TaskUsecase.
func (a *TaskUsecase) Create(ctx context.Context, user *domain.User, req domain.CreateTaskReq) (*domain.ProjectTask, error) {
	if err := validateAttachments(req.Attachments, a.cfg.Attachment); err != nil {
		return nil, err
	}

	r, err := a.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: []string{req.HostID},
	})
	if err != nil {
		return nil, errcode.ErrHostOffline.Wrap(err)
	}
	if !r.OnlineMap[req.HostID] {
		return nil, errcode.ErrHostOffline
	}

	// 模型访问校验（仅在注入 ModelHook 时生效）
	if a.modelHook != nil {
		if err := a.modelHook.ValidateAccess(ctx, user.ID, req.ModelID); err != nil {
			return nil, err
		}
	}

	req.Now = time.Now()
	var token string

	git := taskflow.Git{
		Token:  token,
		Branch: req.RepoReq.Branch,
	}

	imageName := ""
	env := make([]string, 0)
	if req.Extra.ProjectID != uuid.Nil {
		project, err := a.projectRepo.Get(ctx, user.ID, req.Extra.ProjectID)
		if err != nil {
			return nil, fmt.Errorf("failed to get project: %w", err)
		}

		git.URL = project.RepoURL
		if project.EnvVariables != nil {
			for k, v := range project.EnvVariables {
				env = append(env, fmt.Sprintf("%s=%v", k, v))
			}
		}
		if project.Edges.Image != nil {
			imageName = project.Edges.Image.Name
		}

		if gi := project.Edges.GitIdentity; gi != nil {
			req.GitIdentityID = gi.ID
		}
	}

	// 根据 GitIdentityID 解析 git token / username / email
	if req.GitIdentityID != uuid.Nil {
		identity, err := a.girepo.Get(ctx, req.GitIdentityID)
		if err != nil {
			return nil, fmt.Errorf("get git identity: %w", err)
		}
		t, err := a.tokenProvider.GetToken(ctx, req.GitIdentityID)
		if err != nil {
			return nil, fmt.Errorf("get git token: %w", err)
		}

		git.Token = t
		git.Username = identity.Username
		git.Email = identity.Email
	}

	limit := 1
	if a.taskHook != nil {
		if req.SystemPrompt == "" {
			// 如果有 TaskHook，获取系统提示词
			if prompt, err := a.taskHook.GetSystemPrompt(ctx, req.Type, req.SubType); err == nil && prompt != "" {
				req.SystemPrompt = prompt
			}
		}

		n, err := a.taskHook.GetMaxConcurrent(ctx, user.ID)
		if err != nil {
			return nil, err
		}
		limit = cmp.Or(n, limit)
	}

	ctx = entx.WithTaskConcurrencyLimit(ctx, limit)

	var createdVm *taskflow.VirtualMachine
	pt, err := a.repo.Create(ctx, user, req, token, func(pt *db.ProjectTask, m *db.Model, i *db.Image) (*taskflow.VirtualMachine, error) {
		t := pt.Edges.Task
		if t == nil {
			return nil, fmt.Errorf("task edge is nil")
		}
		if git.URL == "" {
			git.URL = pt.RepoURL
		}

		var token string
		if keys := m.Edges.Apikeys; len(keys) > 0 {
			m.APIKey = keys[0].APIKey
			m.BaseURL = a.cfg.LLMProxy.BaseURL + "/v1"
			token = keys[0].APIKey
		}

		coding, configs, err := a.getCodingConfigs(req.CliName, m, req.Extra.SkillIDs)
		if err != nil {
			return nil, err
		}

		vm, err := a.taskflow.VirtualMachiner().Create(ctx, &taskflow.CreateVirtualMachineReq{
			UserID:   user.ID.String(),
			HostID:   req.HostID,
			HostName: t.ID.String(),
			Git:      git,
			ZipUrl:   req.RepoReq.ZipURL,
			ImageURL: cmp.Or(imageName, i.Name),
			ProxyURL: "",
			TaskID:   t.ID,
			LLM: taskflow.LLMProviderReq{
				Provider: taskflow.LlmProviderOpenAI,
				ApiKey:   m.APIKey,
				BaseURL:  m.BaseURL,
				Model:    m.Model,
			},
			Cores:    "2",
			Memory:   8 << 30,
			Envs:     env,
			LogStore: normalizeTaskLogStore(t.LogStore),
		})
		if err != nil {
			return nil, err
		}

		if vm == nil {
			return nil, fmt.Errorf("vm is nil")
		}
		createdVm = vm

		mcps := a.buildMCPConfigs(t.ID, token)

		// 存储 CreateTaskReq 到 Redis（10 分钟过期），供 Lifecycle Manager 消费
		createTaskReq := &taskflow.CreateTaskReq{
			ID:           t.ID,
			VMID:         vm.ID,
			Text:         req.Content,
			Attachments:  taskAttachmentsToTaskflow(req.Attachments),
			SystemPrompt: req.SystemPrompt,
			CodingAgent:  coding,
			LLM: taskflow.LLM{
				ApiKey:  m.APIKey,
				BaseURL: m.BaseURL,
				Model:   m.Model,
				ApiType: m.InterfaceType,
			},
			Configs:    configs,
			McpConfigs: mcps,
			LogStore:   normalizeTaskLogStore(t.LogStore),
		}
		b, err := json.Marshal(createTaskReq)
		if err != nil {
			return vm, err
		}
		reqKey := fmt.Sprintf("task:create_req:%s", t.ID.String())
		if err := a.redis.Set(ctx, reqKey, string(b), 10*time.Minute).Err(); err != nil {
			a.logger.WarnContext(ctx, "failed to store CreateTaskReq in Redis", "error", err)
		}

		return vm, nil
	})
	if err != nil {
		a.logger.With("error", err, "req", req).ErrorContext(ctx, "failed to create task")
		return nil, err
	}
	a.logger.With("req", req).InfoContext(ctx, "task created")
	taskMeta := lifecycle.TaskMetadata{
		TaskID: pt.TaskID,
		UserID: user.ID,
	}
	if err := a.taskLifecycle.Transition(ctx, pt.TaskID, consts.TaskStatusPending, taskMeta); err != nil {
		a.logger.WarnContext(ctx, "task lifecycle transition failed", "error", err)
	}

	if createdVm != nil {
		vmMeta := lifecycle.VMMetadata{
			VMID:   createdVm.ID,
			TaskID: &pt.TaskID,
			UserID: user.ID,
		}
		if err := a.vmLifecycle.Transition(ctx, createdVm.ID, lifecycle.VMStatePending, vmMeta); err != nil {
			a.logger.WarnContext(ctx, "vm lifecycle transition failed", "error", err)
		}
	}

	if err := a.IncrUserInputCount(ctx, user.ID, pt.Edges.Task.ID); err != nil {
		a.logger.WarnContext(ctx, "failed to incr user input count on create", "error", err)
	}
	vmID := ""
	if createdVm != nil {
		vmID = createdVm.ID
	}
	a.refreshCreatedTaskState(ctx, pt.TaskID, vmID)

	result := cvt.From(pt, &domain.ProjectTask{})

	// 通知 TaskHook（如内部项目的 git task 创建等）
	if a.taskHook != nil {
		if err := a.taskHook.OnTaskCreated(ctx, result); err != nil {
			a.logger.WarnContext(ctx, "taskHook.OnTaskCreated failed", "error", err)
		}
	}

	return result, nil
}

func (a *TaskUsecase) refreshCreatedTaskState(ctx context.Context, taskID uuid.UUID, vmID string) {
	if err := a.taskActivityRefresher.ForceRefresh(ctx, taskID); err != nil {
		a.logger.WarnContext(ctx, "failed to refresh task last active on create", "task_id", taskID, "error", err)
	}
	if vmID == "" {
		return
	}
	if err := a.idleRefresher.Refresh(ctx, vmID); err != nil {
		a.logger.WarnContext(ctx, "failed to refresh vm idle timers on create", "task_id", taskID, "vm_id", vmID, "error", err)
	}
}

func (a *TaskUsecase) buildMCPConfigs(taskID uuid.UUID, token string) []taskflow.McpServerConfig {
	mcps := []taskflow.McpServerConfig{
		{
			Type: "http",
			Name: "mcaiBuiltin",
			Url:  proto.String(fmt.Sprintf("http://127.0.0.1:65510/mcp?task_id=%s", taskID.String())),
		},
	}

	if token != "" {
		mcps = append(mcps, taskflow.McpServerConfig{
			Type: "http",
			Name: "monkeycode-ai",
			Url:  proto.String(fmt.Sprintf("%s/mcp", strings.TrimRight(a.cfg.Server.BaseURL, "/"))),
			Headers: []*taskflow.McpHttpHeader{
				{
					Name:  "Authorization",
					Value: fmt.Sprintf("Bearer %s", token),
				},
			},
			Command: new(string),
			Args:    []string{},
			Env:     map[string]string{},
		})
	}

	return mcps
}

func opencodeNpmPackage(interfaceType string) (string, error) {
	switch consts.InterfaceType(interfaceType) {
	case consts.InterfaceTypeOpenAIChat:
		return "@ai-sdk/openai-compatible", nil
	case consts.InterfaceTypeOpenAIResponse:
		return "@ai-sdk/openai", nil
	case consts.InterfaceTypeAnthropic:
		return "@ai-sdk/anthropic", nil
	default:
		return "", fmt.Errorf("unsupported interface type: %s, supported types: %s, %s, %s",
			interfaceType,
			consts.InterfaceTypeOpenAIChat,
			consts.InterfaceTypeOpenAIResponse,
			consts.InterfaceTypeAnthropic,
		)
	}
}

func modelRuntimeDefaults(m *db.Model) (thinking bool, contextLimit int, outputLimit int) {
	thinking = m.ThinkingEnabled
	contextLimit = cmp.Or(m.ContextLimit, 200000)
	outputLimit = cmp.Or(m.OutputLimit, 32000)
	return thinking, contextLimit, outputLimit
}

func (a *TaskUsecase) getCodingConfigs(cli consts.CliName, m *db.Model, skillIDs []string) (taskflow.CodingAgent, []taskflow.ConfigFile, error) {
	var tmp string
	var path string
	var coding taskflow.CodingAgent
	if m == nil {
		return coding, nil, fmt.Errorf("model is nil")
	}
	npmPackage := "@ai-sdk/openai-compatible"
	thinkingEnabled, contextLimit, outputLimit := modelRuntimeDefaults(m)
	cfs := make([]taskflow.ConfigFile, 0)
	switch cli {
	case consts.CliNameClaude:
		tmp = string(templates.Claude)
		path = "~/.claude/settings.json"
		coding = taskflow.CodingAgentClaude
		m.BaseURL = strings.ReplaceAll(m.BaseURL, "/v1", "")

	case consts.CliNameCodex:
		tmp = string(templates.Codex)
		path = "~/.codex/config.toml"
		coding = taskflow.CodingAgentCodex

	case consts.CliNameOpencode:
		tmp = string(templates.OpenCode)
		path = "~/.config/opencode/opencode.json"
		coding = taskflow.CodingAgentOpenCode

		var err error
		npmPackage, err = opencodeNpmPackage(m.InterfaceType)
		if err != nil {
			return coding, nil, err
		}

		authtemp, err := template.New("auth").Parse(string(templates.OpenCodeAuth))
		if err != nil {
			return coding, nil, err
		}

		var authBuf bytes.Buffer
		if err := authtemp.Execute(&authBuf, map[string]any{
			"api_key": m.APIKey,
		}); err != nil {
			return coding, nil, err
		}
		authMode := uint32(0o600)
		cfs = append(cfs, taskflow.ConfigFile{
			Path:    "~/.local/share/opencode/auth.json",
			Content: authBuf.String(),
			Mode:    &authMode,
		})

	default:
		return coding, nil, fmt.Errorf("unexpected consts.CliName: %#v", cli)
	}

	temp, err := template.New("config").Parse(tmp)
	if err != nil {
		return coding, nil, err
	}

	var buf bytes.Buffer
	if err := temp.Execute(&buf, map[string]any{
		"model":            m.Model,
		"base_url":         m.BaseURL,
		"api_key":          m.APIKey,
		"npm_package":      npmPackage,
		"thinking_enabled": thinkingEnabled,
		"context_limit":    contextLimit,
		"output_limit":     outputLimit,
	}); err != nil {
		return coding, nil, err
	}

	cfs = append(cfs, taskflow.ConfigFile{
		Path:    path,
		Content: buf.String(),
	})

	if len(skillIDs) == 0 {
		return coding, cfs, nil
	}

	for _, skillID := range skillIDs {
		skilldir := filepath.Join(consts.SkillBaseDir, skillID)
		if _, err := os.Stat(skilldir); os.IsNotExist(err) {
			continue
		}
		filepath.Walk(skilldir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			// 获取相对于 skilldir 的相对路径，保留目录结构
			relPath, err := filepath.Rel(skilldir, path)
			if err != nil {
				return err
			}
			realSkillID := filepath.Base(skilldir)
			agentSkillDir := "/tmp/codingmatrix-project-tpl/.ai-ready/skills/"
			cfs = append(cfs, taskflow.ConfigFile{
				Path:    filepath.Join(agentSkillDir, realSkillID, relPath),
				Content: string(content),
			})
			return nil
		})
	}
	return coding, cfs, nil
}

// Update implements domain.TaskUsecase.
func (a *TaskUsecase) Update(ctx context.Context, user *domain.User, req domain.UpdateTaskReq) error {
	return a.repo.Update(ctx, user, req.ID, func(up *db.TaskUpdateOne) error {
		if req.Title != nil {
			up.SetTitle(*req.Title)
		}
		return nil
	})
}

// Delete implements domain.TaskUsecase.
func (a *TaskUsecase) Delete(ctx context.Context, user *domain.User, id uuid.UUID) error {
	t, err := a.repo.Info(ctx, user, id, false)
	if err != nil {
		if db.IsNotFound(err) {
			return errcode.ErrNotFound
		}
		return err
	}

	// 回收 VM（如果有且未回收）
	if vms := t.Edges.Vms; len(vms) > 0 {
		vm := vms[0]
		if !vm.IsRecycled {
			if err := a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStateRecycled, lifecycle.VMMetadata{
				VMID:   vm.ID,
				TaskID: &id,
				UserID: user.ID,
			}); err != nil {
				a.logger.WarnContext(ctx, "vm recycle transition failed on delete", "error", err, "vm_id", vm.ID)
			}
		}
	}

	return a.repo.Delete(ctx, user, id)
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
