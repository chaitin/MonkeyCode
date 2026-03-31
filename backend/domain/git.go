package domain

import (
	"context"
	"io"
)

// GitClienter Git 平台统一客户端接口
type GitClienter interface {
	// 认证
	CheckPAT(ctx context.Context, token, repoURL string) (bool, *BindRepository, error)
	UserInfo(ctx context.Context, token string) (*PlatformUserInfo, error)
	Repositories(ctx context.Context, opts *RepositoryOptions) ([]AuthRepository, error)

	// 仓库操作
	Tree(ctx context.Context, opts *TreeOptions) (*GetRepoTreeResp, error)
	Blob(ctx context.Context, opts *BlobOptions) (*GetBlobResp, error)
	Logs(ctx context.Context, opts *LogsOptions) (*GetGitLogsResp, error)
	Archive(ctx context.Context, opts *ArchiveOptions) (*GetRepoArchiveResp, error)
	Branches(ctx context.Context, opts *BranchesOptions) ([]*BranchInfo, error)

	// Webhook
	DeleteWebhook(ctx context.Context, opts *WebhookOptions) error
	CreateWebhook(ctx context.Context, opts *CreateWebhookOptions) error
}

// TreeEntry 文件树节点
type TreeEntry struct {
	Mode           int
	Name           string
	Path           string
	Sha            string
	Size           int
	LastModifiedAt int64 // GitHub 特有，其他平台为 0
}

// GetRepoTreeResp 获取仓库文件树响应
type GetRepoTreeResp struct {
	Entries []*TreeEntry
	SHA     string
}

// GetBlobResp 获取单文件内容响应
type GetBlobResp struct {
	Content  []byte
	IsBinary bool
	Sha      string
	Size     int
}

// GitUser 提交用户信息
type GitUser struct {
	Email string
	Name  string
	When  int64
}

// GitCommit 提交信息
type GitCommit struct {
	Author     *GitUser
	Committer  *GitUser
	Message    string
	ParentShas []string
	Sha        string
	TreeSha    string
}

// GitCommitEntry 包装 commit 对象
type GitCommitEntry struct {
	Commit *GitCommit
}

// GetGitLogsResp 获取提交历史响应
type GetGitLogsResp struct {
	Count   int
	Entries []*GitCommitEntry
}

// GetRepoArchiveResp 获取仓库压缩包响应
type GetRepoArchiveResp struct {
	ContentLength int64
	ContentType   string
	Reader        io.ReadCloser
}

// BranchInfo 分支信息
type BranchInfo struct {
	Name string
}

// PlatformUserInfo 平台用户信息
type PlatformUserInfo struct {
	Name string
}

// BindRepository 绑定仓库信息
type BindRepository struct {
	RepoID          string
	RepoName        string
	FullName        string
	RepoURL         string
	RepoDescription string
	IsPrivate       bool
	Platform        string
}

type RepositoryOptions struct {
	Token     string
	InstallID int64 // GitHub App 模式，其他平台忽略
	IsOAuth   bool  // GitLab/Gitea OAuth 模式，其他平台忽略
}

// TreeOptions 获取文件树参数
type TreeOptions struct {
	Token     string
	Owner     string
	Repo      string
	Ref       string
	Path      string
	Recursive bool
	InstallID int64 // GitHub App 模式，其他平台忽略
	IsOAuth   bool  // GitLab/Gitea OAuth 模式，其他平台忽略
}

// BlobOptions 获取文件内容参数
type BlobOptions struct {
	Token     string
	Owner     string
	Repo      string
	Ref       string
	Path      string
	InstallID int64
	IsOAuth   bool
}

// LogsOptions 获取提交历史参数
type LogsOptions struct {
	Token     string
	Owner     string
	Repo      string
	Ref       string
	Path      string
	Limit     int
	Offset    int
	InstallID int64
	IsOAuth   bool
}

// ArchiveOptions 获取归档参数
type ArchiveOptions struct {
	Token     string
	Owner     string
	Repo      string
	Ref       string
	InstallID int64
	IsOAuth   bool
}

// BranchesOptions 列出分支参数
type BranchesOptions struct {
	Token     string
	Owner     string
	Repo      string
	Page      int
	PerPage   int
	InstallID int64
	IsOAuth   bool
}

// WebhookOptions Webhook 操作参数
type WebhookOptions struct {
	Token      string
	RepoURL    string
	WebhookURL string
	IsOAuth    bool
}

// CreateWebhookOptions 创建 Webhook 参数
type CreateWebhookOptions struct {
	Token       string
	RepoURL     string
	WebhookURL  string
	SecretToken string
	Events      []string
	IsOAuth     bool
}
