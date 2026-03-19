package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// GitTaskUsecase GitTask 业务逻辑接口
type GitTaskUsecase interface {
	Create(ctx context.Context, req CreateGitTaskReq) (*GitTask, error)
}

// GitTaskRepoInterface GitTask 数据访问接口
type GitTaskRepoInterface interface {
	Create(ctx context.Context, req CreateGitTaskReq, fn func(user *db.User, t *db.Task, m *db.Model, i *db.Image) (*taskflow.VirtualMachine, error)) (*db.Task, error)
}

// CreateGitTaskReq 创建 GitTask 请求
type CreateGitTaskReq struct {
	HostID               string             `json:"host_id"`
	ImageID              uuid.UUID          `json:"image_id"`
	Subject              Subject            `json:"subject"`
	Repo                 Repo               `json:"repo"`
	User                 User               `json:"user"`
	Platform             consts.GitPlatform `json:"platform"`
	Body                 string             `json:"body"`
	Time                 time.Time          `json:"time"`
	Prompt               string             `json:"prompt"`
	PromptID             string             `json:"prompt_id"`
	GithubInstallationID int64              `json:"github_installation_id"`
	Env                  map[string]string  `json:"env"`
	Git                  taskflow.Git       `json:"git"`
	Bot                  *GitBot            `json:"-"`
}

// Subject 任务主题
type Subject struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Number int    `json:"number"`
}

// Repo 仓库信息
type Repo struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	FullName  string  `json:"fullname"`
	URL       string  `json:"url"`
	Desc      string  `json:"desc"`
	Branch    *string `json:"branch"`
	IsPrivate bool    `json:"is_private"`
}
