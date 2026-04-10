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
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/templates"
)

// TaskUsecase 任务业务逻辑实现
type TaskUsecase struct {
	cfg              *config.Config
	repo             domain.TaskRepo
	modelRepo        domain.ModelRepo
	logger           *slog.Logger
	taskflow         taskflow.Clienter
	loki             *loki.Client
	redis            *redis.Client
	notifyDispatcher *dispatcher.Dispatcher
	taskHook         domain.TaskHook
	privilegeChecker domain.PrivilegeChecker
	modelHook        domain.ModelHook
	taskLifecycle    *lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]
	vmLifecycle      *lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata]
	girepo           domain.GitIdentityRepo
	tokenProvider    *gituc.TokenProvider
	projectRepo      domain.ProjectRepo
}

// NewTaskUsecase 创建任务业务逻辑实例
func NewTaskUsecase(i *do.Injector) (domain.TaskUsecase, error) {
	u := &TaskUsecase{
		cfg:              do.MustInvoke[*config.Config](i),
		repo:             do.MustInvoke[domain.TaskRepo](i),
		modelRepo:        do.MustInvoke[domain.ModelRepo](i),
		logger:           do.MustInvoke[*slog.Logger](i).With("module", "usecase.TaskUsecase"),
		taskflow:         do.MustInvoke[taskflow.Clienter](i),
		loki:             do.MustInvoke[*loki.Client](i),
		redis:            do.MustInvoke[*redis.Client](i),
		notifyDispatcher: do.MustInvoke[*dispatcher.Dispatcher](i),
		taskLifecycle:    do.MustInvoke[*lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]](i),
		vmLifecycle:      do.MustInvoke[*lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata]](i),
		girepo:           do.MustInvoke[domain.GitIdentityRepo](i),
		tokenProvider:    do.MustInvoke[*gituc.TokenProvider](i),
		projectRepo:      do.MustInvoke[domain.ProjectRepo](i),
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

		if resp != nil && resp.OnlineMap[vm.ID] {
			vm.Status = taskflow.VirtualMachineStatusOnline
		} else {
			vm.Status = taskflow.VirtualMachineStatusPending

			for _, cond := range vm.Conditions {
				switch cond.Type {
				case types.ConditionTypeFailed:
					vm.Status = taskflow.VirtualMachineStatusOffline
				case types.ConditionTypeHibernated:
					vm.Status = taskflow.VirtualMachineStatusHibernated
				case types.ConditionTypeReady:
					if time.Since(time.Unix(vm.CreatedAt, 0)) > 2*time.Minute {
						vm.Status = taskflow.VirtualMachineStatusOffline
					}
				}
			}
		}
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
			ID: id,
		},
	}); err != nil {
		return err
	}

	return nil
}

// Continue implements domain.TaskUsecase.
func (a *TaskUsecase) Continue(ctx context.Context, user *domain.User, id uuid.UUID, content string) error {
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

	pt, err := a.repo.Create(ctx, user, req, token, func(pt *db.ProjectTask, m *db.Model, i *db.Image) (*taskflow.VirtualMachine, error) {
		t := pt.Edges.Task
		if t == nil {
			return nil, fmt.Errorf("task edge is nil")
		}
		if git.URL == "" {
			git.URL = pt.RepoURL
		}

		if keys := m.Edges.Apikeys; len(keys) > 0 {
			m.APIKey = keys[0].APIKey
			m.BaseURL = a.cfg.LLMProxy.BaseURL + "/v1"
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
			Cores:  fmt.Sprintf("%d", req.Resource.Core),
			Memory: req.Resource.Memory,
			Envs:   env,
		})
		if err != nil {
			return nil, err
		}

		if vm == nil {
			return nil, fmt.Errorf("vm is nil")
		}

		mcps := []taskflow.McpServerConfig{
			{
				Type: "http",
				Name: "mcaiBuiltin",
				Url:  proto.String(fmt.Sprintf("http://127.0.0.1:65510/mcp?task_id=%s", t.ID.String())),
			},
			{
				Type: "http",
				Name: "context7",
				Url:  proto.String("https://mcp.context7.com/mcp"),
				Headers: []*taskflow.McpHttpHeader{
					{
						Name:  "CONTEXT7_API_KEY",
						Value: a.cfg.Context7ApiKey,
					},
				},
			},
		}

		taskMeta := lifecycle.TaskMetadata{
			TaskID: t.ID,
			UserID: user.ID,
		}
		if err := a.taskLifecycle.Transition(ctx, t.ID, consts.TaskStatusPending, taskMeta); err != nil {
			a.logger.WarnContext(ctx, "task lifecycle transition failed", "error", err)
		}

		vmMeta := lifecycle.VMMetadata{
			VMID:   vm.ID,
			TaskID: &t.ID,
			UserID: user.ID,
		}
		if err := a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStatePending, vmMeta); err != nil {
			a.logger.WarnContext(ctx, "vm lifecycle transition failed", "error", err)
		}

		// 存储 CreateTaskReq 到 Redis（10 分钟过期），供 Lifecycle Manager 消费
		createTaskReq := &taskflow.CreateTaskReq{
			ID:           t.ID,
			VMID:         vm.ID,
			Text:         req.Content,
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

	if err := a.IncrUserInputCount(ctx, user.ID, pt.Edges.Task.ID); err != nil {
		a.logger.WarnContext(ctx, "failed to incr user input count on create", "error", err)
	}

	result := cvt.From(pt, &domain.ProjectTask{})

	// 通知 TaskHook（如内部项目的 git task 创建等）
	if a.taskHook != nil {
		if err := a.taskHook.OnTaskCreated(ctx, result); err != nil {
			a.logger.WarnContext(ctx, "taskHook.OnTaskCreated failed", "error", err)
		}
	}

	return result, nil
}

func (a *TaskUsecase) getCodingConfigs(cli consts.CliName, m *db.Model, skillIDs []string) (taskflow.CodingAgent, []taskflow.ConfigFile, error) {
	var tmp string
	var path string
	var coding taskflow.CodingAgent
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
		cfs = append(cfs, taskflow.ConfigFile{
			Path:    "~/.local/share/opencode/auth.json",
			Content: authBuf.String(),
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
		"model":    m.Model,
		"base_url": m.BaseURL,
		"api_key":  m.APIKey,
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
