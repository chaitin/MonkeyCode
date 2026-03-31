package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// GitBotUsecase GitBot 业务逻辑接口
type GitBotUsecase interface {
	GetByID(ctx context.Context, id uuid.UUID) (*GitBot, error)
	GetInstallationID(ctx context.Context, botID uuid.UUID) (int64, error)
	GetAccessToken(ctx context.Context, botID uuid.UUID) (string, error)
	List(ctx context.Context, uid uuid.UUID) (*ListGitBotResp, error)
	Create(ctx context.Context, uid uuid.UUID, req CreateGitBotReq) (*GitBot, error)
	Update(ctx context.Context, uid uuid.UUID, req UpdateGitBotReq) (*GitBot, error)
	Delete(ctx context.Context, uid, id uuid.UUID) error
	ListTask(ctx context.Context, uid uuid.UUID, req ListGitBotTaskReq) (*ListGitBotTaskResp, error)
	ShareBot(ctx context.Context, uid uuid.UUID, req ShareGitBotReq) error
}

// GitBotRepo GitBot 数据访问接口
type GitBotRepo interface {
	GetByID(ctx context.Context, id uuid.UUID) (*db.GitBot, error)
	GetInstallationID(ctx context.Context, botID uuid.UUID) (int64, error)
	GetGitIdentityID(ctx context.Context, botID uuid.UUID) (uuid.UUID, error)
	List(ctx context.Context, uid uuid.UUID) ([]*db.GitBot, error)
	Create(ctx context.Context, uid uuid.UUID, req CreateGitBotReq) (*db.GitBot, error)
	Update(ctx context.Context, uid uuid.UUID, req UpdateGitBotReq) (*db.GitBot, error)
	Delete(ctx context.Context, uid, id uuid.UUID) error
	ListTask(ctx context.Context, uid uuid.UUID, req ListGitBotTaskReq) ([]*db.GitBotTask, *db.PageInfo, error)
	ShareBot(ctx context.Context, uid uuid.UUID, req ShareGitBotReq) error
}

// GitBot Git Bot 实体
type GitBot struct {
	ID          uuid.UUID          `json:"id"`
	Platform    consts.GitPlatform `json:"platform"`
	Name        string             `json:"name"`
	Token       string             `json:"token"`
	SecretToken string             `json:"secret_token"`
	Host        *Host              `json:"host"`
	WebhookURL  string             `json:"webhook_url"`
	Users       []*User            `json:"users"`
	CreatedAt   int64              `json:"created_at"`
}

// From 从 ent 实体转换
func (g *GitBot) From(src *db.GitBot) *GitBot {
	if src == nil {
		return g
	}
	g.ID = src.ID
	g.Platform = src.Platform
	g.Name = src.Name
	g.Token = src.Token
	g.SecretToken = src.SecretToken
	g.Host = cvt.From(src.Edges.Host, &Host{})
	g.Users = cvt.Iter(src.Edges.Users, func(_ int, u *db.User) *User {
		return cvt.From(u, &User{})
	})
	g.CreatedAt = src.CreatedAt.Unix()
	return g
}

// CreateGitBotReq 创建 Git Bot 请求
type CreateGitBotReq struct {
	Platform consts.GitPlatform `json:"platform" validate:"required"`
	Name     string             `json:"name"`
	Token    string             `json:"token" validate:"required"`
	HostID   string             `json:"host_id" validate:"required"`
}

// UpdateGitBotReq 更新 Git Bot 请求
type UpdateGitBotReq struct {
	ID       uuid.UUID           `json:"id" validate:"required"`
	Platform *consts.GitPlatform `json:"platform"`
	HostID   *string             `json:"host_id"`
	Name     *string             `json:"name"`
	Token    *string             `json:"token"`
}

// ShareGitBotReq 共享 Git Bot 请求
type ShareGitBotReq struct {
	ID      uuid.UUID   `json:"id"`
	UserIDs []uuid.UUID `json:"user_ids"`
}

// ListGitBotResp Git Bot 列表响应
type ListGitBotResp struct {
	Bots []*GitBot `json:"bots"`
}

// ListGitBotTaskReq Git Bot 任务列表请求
type ListGitBotTaskReq struct {
	ID   uuid.UUID `json:"id" query:"id" validate:"omitempty"`
	Page int       `json:"page" query:"page"`
	Size int       `json:"size" query:"size"`
}

// ListGitBotTaskResp Git Bot 任务列表响应
type ListGitBotTaskResp struct {
	Tasks []*GitBotTask `json:"tasks"`
	Page  int64         `json:"page"`
	Size  int64         `json:"size"`
	Total int64         `json:"total"`
}

// GitBotTask Git Bot 任务实体
type GitBotTask struct {
	ID          uuid.UUID         `json:"id"`
	PullRequest PullRequest       `json:"pull_request"`
	Repo        GitRepository     `json:"repo"`
	Status      consts.TaskStatus `json:"status"`
	Bot         *GitBot           `json:"bot"`
	CreatedAt   int64             `json:"created_at"`
}

// From 从 ent 实体转换
func (g *GitBotTask) From(src *db.GitBotTask) *GitBotTask {
	if src == nil {
		return g
	}
	g.ID = src.ID
	g.CreatedAt = src.CreatedAt.Unix()
	if bot := src.Edges.GitBot; bot != nil {
		g.Bot = cvt.From(bot, &GitBot{})
	}
	if task := src.Edges.Task; task != nil {
		g.Status = task.Status
	}
	return g
}

// PullRequest PR/MR 信息
type PullRequest struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

// GitRepository Git 仓库信息
type GitRepository struct {
	URL      string             `json:"url"`
	RepoName string             `json:"repo_name"`
	Owner    string             `json:"owner"`
	Platform consts.GitPlatform `json:"platform"`
}
