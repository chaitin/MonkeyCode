package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// IDReq 通用 ID 请求
type IDReq[T any] struct {
	ID T `json:"id" query:"id" param:"id" validate:"required"`
}

// PrivilegeChecker 特权用户检查接口（可选，内部项目通过 WithPrivilegeChecker 注入）
type PrivilegeChecker interface {
	IsPrivileged(ctx context.Context, uid uuid.UUID) (bool, error)
}

// InternalHook 内部 handler 回调接口（可选，内部项目通过 WithInternalHook 注入）
// 用于扩展 taskflow 回调端点中与 task 系统耦合的逻辑
type InternalHook interface {
	// OnAgentAuth agent 认证成功后获取关联的 TaskID
	OnAgentAuth(ctx context.Context, vmID string) uuid.UUID
	// OnVmReady VM 就绪回调（如任务状态转换）
	OnVmReady(ctx context.Context, vmID string) error
	// OnVmConditionFailed VM 条件失败回调（如任务状态转换）
	OnVmConditionFailed(ctx context.Context, vmID string) error
	// GitCredential 获取 git 凭证（与内部 project/git identity 系统耦合）
	GitCredential(ctx context.Context, req *taskflow.GitCredentialRequest) (*taskflow.GitCredentialResponse, error)
}

// TaskHook 任务模块回调接口（可选，内部项目通过 WithTaskHook 注入）
// 用于扩展 task 模块中与 gittask/task_system_prompt/gitidentity 耦合的逻辑
type TaskHook interface {
	// GetSystemPrompt 获取任务系统提示词
	GetSystemPrompt(ctx context.Context, taskType consts.TaskType, subType consts.TaskSubType) (string, error)
	// GetGitToken 获取 git 凭证 token
	GetGitToken(ctx context.Context, gitIdentityID uuid.UUID, platform consts.GitPlatform) (string, error)
	// OnTaskCreated 任务创建后回调
	OnTaskCreated(ctx context.Context, task *ProjectTask) error
	// GitTask 获取 git 任务详情
	GitTask(ctx context.Context, id uuid.UUID) (*GitTask, error)
}

// ProjectHook 项目模块回调接口（可选，内部项目通过 WithProjectHook 注入）
type ProjectHook interface {
	// GenerateIssueSummary 生成问题摘要
	GenerateIssueSummary(ctx context.Context, issueID uuid.UUID) error
	// GetInternalRepoToken 获取内部仓库 token
	GetInternalRepoToken(ctx context.Context, userID uuid.UUID, projectID uuid.UUID) (string, error)
}

// SiteResolver 站点解析接口（可选，内部项目通过 WithSiteResolver 注入）
type SiteResolver interface {
	// ResolveByHost 通过域名解析站点配置
	ResolveByHost(ctx context.Context, host string) (*OAuthSiteConfig, error)
	// ResolveBySiteID 通过站点 ID 解析站点配置
	ResolveBySiteID(ctx context.Context, siteID uuid.UUID) (*OAuthSiteConfig, error)
}

// OAuthSiteConfig OAuth 站点配置
type OAuthSiteConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Scope        string
	BaseURL      string
}
