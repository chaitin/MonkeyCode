package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// GitTaskUsecase GitTask 业务逻辑实现
type GitTaskUsecase struct {
	cfg           *config.Config
	logger        *slog.Logger
	repo          domain.GitTaskRepoInterface
	taskflow      taskflow.Clienter
	redis         *redis.Client
	taskLifecycle *lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]
	vmLifecycle   *lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata]
}

// NewGitTaskUsecase 创建 GitTaskUsecase
func NewGitTaskUsecase(i *do.Injector) (domain.GitTaskUsecase, error) {
	return &GitTaskUsecase{
		cfg:           do.MustInvoke[*config.Config](i),
		logger:        do.MustInvoke[*slog.Logger](i).With("module", "usecase.GitTaskUsecase"),
		repo:          do.MustInvoke[domain.GitTaskRepoInterface](i),
		taskflow:      do.MustInvoke[taskflow.Clienter](i),
		redis:         do.MustInvoke[*redis.Client](i),
		taskLifecycle: do.MustInvoke[*lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata]](i),
		vmLifecycle:   do.MustInvoke[*lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata]](i),
	}, nil
}

// Create implements domain.GitTaskUsecase.
func (g *GitTaskUsecase) Create(ctx context.Context, req domain.CreateGitTaskReq) (*domain.GitTask, error) {
	if strings.Contains(req.Body, "> 我是 [MonkeyCode AI 编程助手]") {
		g.logger.With("comment", req.Subject.ID).Info("ignore comment from MonkeyCode AI 编程助手")
		return nil, nil
	}

	if req.Env == nil {
		req.Env = make(map[string]string)
	}

	tk, err := g.repo.Create(ctx, req, func(u *db.User, t *db.Task, m *db.Model, img *db.Image) (*taskflow.VirtualMachine, error) {
		branch := "master"
		if req.Repo.Branch != nil {
			branch = *req.Repo.Branch
		}

		vm, err := g.taskflow.VirtualMachiner().Create(ctx, &taskflow.CreateVirtualMachineReq{
			UserID:   u.ID.String(),
			HostID:   req.HostID,
			HostName: t.ID.String(),
			Git: taskflow.Git{
				URL:      req.Repo.URL,
				Username: "MonkeyCode-AI",
				Email:    "monkeycode-ai@chaitin.com",
				Branch:   branch,
				Token:    req.Git.Token,
			},
			ImageURL: img.Name,
			TTL: taskflow.TTL{
				Kind:    taskflow.TTLCountDown,
				Seconds: 60 * 60,
			},
			TaskID: t.ID,
			LLM: taskflow.LLMProviderReq{
				Provider: taskflow.LlmProviderOpenAI,
				ApiKey:   m.APIKey,
				BaseURL:  m.BaseURL,
				Model:    m.Model,
			},
			Cores:  fmt.Sprintf("%d", g.cfg.Task.Core),
			Memory: g.cfg.Task.Memory,
		})
		if err != nil {
			return nil, err
		}
		if vm == nil {
			return nil, fmt.Errorf("failed to create virtual machine")
		}

		// Lifecycle 状态转换
		taskMeta := lifecycle.TaskMetadata{TaskID: t.ID, UserID: u.ID}
		if err := g.taskLifecycle.Transition(ctx, t.ID, consts.TaskStatusPending, taskMeta); err != nil {
			g.logger.WarnContext(ctx, "task lifecycle transition failed", "error", err)
		}

		vmMeta := lifecycle.VMMetadata{VMID: vm.ID, TaskID: &t.ID, UserID: u.ID}
		if err := g.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStatePending, vmMeta); err != nil {
			g.logger.WarnContext(ctx, "vm lifecycle transition failed", "error", err)
		}

		// 存储 CreateTaskReq 到 Redis，供 Lifecycle TaskHook 消费
		req.Env["BASE_URL"] = g.cfg.Server.BaseURL
		req.Env["TASK_ID"] = t.ID.String()
		createTaskReq := &taskflow.CreateTaskReq{
			ID:          t.ID,
			VMID:        vm.ID,
			Text:        req.Prompt,
			CodingAgent: taskflow.CodingAgentMCAIReview,
			LLM: taskflow.LLM{
				ApiKey:  m.APIKey,
				BaseURL: m.BaseURL,
				Model:   m.Model,
			},
			Env: req.Env,
		}
		b, err := json.Marshal(createTaskReq)
		if err != nil {
			return vm, err
		}
		reqKey := fmt.Sprintf("task:create_req:%s", t.ID.String())
		if err := g.redis.Set(ctx, reqKey, string(b), 10*time.Minute).Err(); err != nil {
			g.logger.WarnContext(ctx, "failed to store CreateTaskReq in Redis", "error", err)
		}

		return vm, nil
	})
	if err != nil {
		g.logger.With("error", err).ErrorContext(ctx, "failed to create git task")
		return nil, err
	}

	result := &domain.GitTask{
		ID:                   tk.ID,
		TaskID:               tk.ID,
		SubjectURL:           req.Subject.URL,
		PromptID:             req.PromptID,
		GithubInstallationID: req.GithubInstallationID,
		Platform:             req.Platform,
		Repo: &domain.GitTaskRepo{
			URL:      req.Repo.URL,
			Platform: req.Platform,
		},
	}

	g.logger.With("task_id", tk.ID).InfoContext(ctx, "git task created")
	return result, nil
}
