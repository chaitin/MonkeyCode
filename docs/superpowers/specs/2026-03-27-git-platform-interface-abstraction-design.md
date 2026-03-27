# Git 平台接口抽象设计

## 背景

当前 GitHub、GitLab、Gitea（及 Gitee）四个 Git 平台的客户端实现存在大量冗余：

1. **类型重复** — `TreeEntry`、`GetBlobResp`、`GitCommit`、`BranchInfo`、`PlatformUserInfo`、`BindRepository` 等在四个包中逐字段重复定义。
2. **调用层 switch 膨胀** — `ProjectUsecase` 中 `GetProjectTree`、`GetProjectBlob`、`GetProjectLogs`、`GetProjectArchive` 每个方法都有 4-way switch，逻辑几乎相同。`githubLogsToProjectLogs` / `gitlabLogsToProjectLogs` / `giteaLogsToProjectLogs` / `giteeLogsToProjectLogs` 四个函数体完全一样。
3. **Webhook handler 重复** — 三个 handler 结构体字段相同，流程相同（解析 ID → 获取 bot → 读 body → 验证签名 → 分发事件 → 构造任务），仅签名验证方式、事件头名称、payload 结构有差异。

## 设计目标

- 消除重复类型定义，统一到 domain 层
- 定义 `GitPlatformClient` 接口，各平台实现该接口
- 用 Options struct 统一方法参数，平台特有配置在构造时注入
- Webhook handler 提取公共流程，平台差异通过策略模式注入
- 保持 API 路由兼容，不改变外部行为

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 抽象范围 | 全面抽象（认证 + 仓库操作 + Webhook） | 三类方法都有明显冗余 |
| 参数统一方式 | 混合方式：构造时注入平台配置 + Options struct 承载通用参数 | 兼顾类型安全和接口简洁 |
| 重复类型处理 | 统一到 domain 层 | domain 已有 `AuthRepository`，自然扩展 |
| Webhook 处理 | 一并抽象，策略模式 | handler 流程高度一致，差异可封装 |

## 详细设计

### 1. 统一类型定义（domain/gitplatform.go）

将各平台包中重复的类型统一到 `domain/gitplatform.go`：

```go
package domain

import "io"

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

// PlatformUserInfo 平台用户信息（合并各平台重复定义）
type PlatformUserInfo struct {
    Name string
}

// BindRepository 绑定仓库信息（合并各平台重复定义）
type BindRepository struct {
    RepoID          string
    RepoName        string
    FullName        string
    RepoURL         string
    RepoDescription string
    IsPrivate       bool
    Platform        string
}
```

删除 `backend/pkg/git/{github,gitlab,gitea,gitee}/types.go` 中的重复定义，以及各平台 `github.go`/`gitlab.go`/`gitea.go` 中的 `PlatformUserInfo` 和 `BindRepository`。

### 2. 统一接口定义（domain/gitplatform.go）

替代现有的 `GitPlatformClient[T]` 泛型接口：

```go
// GitPlatformClient Git 平台统一客户端接口
type GitPlatformClient interface {
    // 认证
    CheckPAT(ctx context.Context, token, repoURL string) (bool, *BindRepository, error)
    UserInfo(ctx context.Context, token string) (*PlatformUserInfo, error)
    Repositories(ctx context.Context, token string) ([]AuthRepository, error)

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
```

Options 结构体定义：

```go
// TreeOptions 获取文件树参数
type TreeOptions struct {
    Token     string
    Owner     string
    Repo      string
    Ref       string
    Path      string
    Recursive bool
    InstallID int64 // GitHub App 模式，其他平台忽略
}

// BlobOptions 获取文件内容参数
type BlobOptions struct {
    Token     string
    Owner     string
    Repo      string
    Ref       string
    Path      string
    InstallID int64
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
}

// ArchiveOptions 获取归档参数
type ArchiveOptions struct {
    Token     string
    Owner     string
    Repo      string
    Ref       string
    InstallID int64
}

// BranchesOptions 列出分支参数
type BranchesOptions struct {
    Token     string
    Owner     string
    Repo      string
    Page      int
    PerPage   int
    InstallID int64
}

// WebhookOptions Webhook 操作参数
type WebhookOptions struct {
    Token      string
    RepoURL    string
    WebhookURL string
}

// CreateWebhookOptions 创建 Webhook 参数
type CreateWebhookOptions struct {
    Token       string
    RepoURL     string
    WebhookURL  string
    SecretToken string
    Events      []string
}
```

### 3. 平台实现

各平台在构造时注入平台特有配置（baseURL、isOAuth 等），接口方法只接收通用 Options 参数。

**GitHub**（`pkg/git/github/github.go`）：
- 构造：`NewGithub(logger, cfg)` 不变
- `installID` 从 Options 中获取
- 实现 `GitPlatformClient` 接口，内部调用 go-github SDK

**GitLab**（`pkg/git/gitlab/gitlab.go`）：
- 构造：`NewGitlab(baseURL, token, logger)` 不变
- `isOAuth` 通过构造参数或 `WithOAuth(bool)` 方法设置
- `Owner`/`Repo` 在实现内部拼接为 `projectPath`

**Gitea**（`pkg/git/gitea/gitea.go`）：
- 构造：`NewGitea(logger, baseURL)` 不变
- `baseURL` 已在构造时注入，方法内不再需要传入

### 4. 调用层简化（ProjectUsecase）

**工厂方法**：

```go
// ClientContext 平台客户端上下文
type ClientContext struct {
    Owner         string
    Repo          string
    DefaultBranch string
    InstallID     int64
    Token         string
}

// getClient 根据项目平台返回对应客户端和上下文
func (u *ProjectUsecase) getClient(p *db.Project) (domain.GitPlatformClient, *ClientContext, error) {
    gi := p.Edges.GitIdentity
    if gi == nil {
        return nil, nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("project has no git identity"))
    }
    token := gi.AccessToken

    switch p.Platform {
    case consts.GitPlatformGithub:
        parsed, err := giturl.Parse(p.RepoURL)
        if err != nil {
            return nil, nil, err
        }
        return u.gh, &ClientContext{
            Owner: parsed.Owner, Repo: parsed.Repo,
            DefaultBranch: p.Branch, InstallID: gi.InstallationID, Token: token,
        }, nil

    case consts.GitPlatformGitLab:
        gl := u.getGitlabClientByBaseURL(gi.BaseURL)
        projectPath, _ := gitlab.ParseProjectPath(p.RepoURL)
        return gl, &ClientContext{
            Owner: projectPath, DefaultBranch: p.Branch, Token: token,
        }, nil

    case consts.GitPlatformGitea:
        owner, repo, _ := gitea.ParseRepoPath(p.RepoURL)
        return u.gta, &ClientContext{
            Owner: owner, Repo: repo, DefaultBranch: p.Branch, Token: token,
        }, nil

    default:
        return nil, nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("unsupported platform: %s", p.Platform))
    }
}
```

**调用简化示例**（以 GetProjectTree 为例）：

```go
func (u *ProjectUsecase) GetProjectTree(ctx context.Context, uid uuid.UUID, req *domain.GetProjectTreeReq) (domain.ProjectTree, error) {
    p, err := u.repo.Get(ctx, uid, req.ID)
    if err != nil {
        return nil, err
    }
    client, cc, err := u.getClient(p)
    if err != nil {
        return nil, err
    }
    ref := req.Ref
    if ref == "" {
        ref = cc.DefaultBranch
    }
    resp, err := client.Tree(ctx, &domain.TreeOptions{
        Token: cc.Token, Owner: cc.Owner, Repo: cc.Repo,
        Ref: ref, Path: req.Path, Recursive: req.Recursive,
        InstallID: cc.InstallID,
    })
    if err != nil {
        return nil, errcode.ErrGitOperation.Wrap(err)
    }
    // 直接转换 domain.TreeEntry → domain.ProjectTreeEntry，无需平台特定转换函数
    return cvt.Iter(resp.Entries, func(_ int, e *domain.TreeEntry) *domain.ProjectTreeEntry {
        return &domain.ProjectTreeEntry{
            Mode: e.Mode, Name: e.Name, Path: e.Path,
            Sha: e.Sha, Size: e.Size, LastModifiedAt: e.LastModifiedAt,
        }
    }), nil
}
```

同理 `GetProjectBlob`、`GetProjectLogs`、`GetProjectArchive` 都变成统一模式，删除 `githubLogsToProjectLogs` 等 4 个重复转换函数。

### 5. Webhook Handler 统一

**策略接口**（`biz/git/handler/v1/webhook_strategy.go`）：

```go
// WebhookStrategy 平台 Webhook 策略
type WebhookStrategy interface {
    ValidateSignature(secret string, r *http.Request, body []byte) error
    EventType(r *http.Request) string
    IsPREvent(eventType string) bool
    ParsePREvent(payload []byte) (*PREvent, error)
    Platform() consts.GitPlatform
    TokenEnvKey() string
}

// PREvent 统一的 PR/MR 事件
type PREvent struct {
    Action string
    ID     int
    Number int
    Title  string
    Body   string
    URL    string
    Branch string
    Repo   domain.Repo
    User   domain.User
}
```

**统一 handler**（`biz/git/handler/v1/webhook.go`）：

```go
type WebhookHandler struct {
    cfg            *config.Config
    logger         *slog.Logger
    redis          *redis.Client
    gitbotUsecase  domain.GitBotUsecase
    gitTaskUsecase domain.GitTaskUsecase
}

func (h *WebhookHandler) Handle(s WebhookStrategy) web.HandlerFunc {
    return func(c *web.Context) error {
        ctx := c.Request().Context()
        id, err := uuid.Parse(c.Param("id"))
        if err != nil {
            return c.String(http.StatusBadRequest, "invalid id")
        }
        bot, err := h.gitbotUsecase.GetByID(ctx, id)
        if err != nil {
            return c.String(http.StatusNotFound, "bot not found")
        }
        body, err := io.ReadAll(c.Request().Body)
        if err != nil {
            return err
        }
        if err := s.ValidateSignature(bot.SecretToken, c.Request(), body); err != nil {
            return c.String(http.StatusUnauthorized, "invalid signature")
        }
        if s.IsPREvent(s.EventType(c.Request())) {
            h.handlePR(ctx, s, bot, body)
        }
        return c.String(http.StatusOK, "ok")
    }
}

func (h *WebhookHandler) handlePR(ctx context.Context, s WebhookStrategy, bot *domain.GitBot, body []byte) {
    ev, err := s.ParsePREvent(body)
    if err != nil {
        h.logger.With("error", err).ErrorContext(ctx, "failed to parse PR event")
        return
    }
    // 统一 action 过滤
    switch strings.ToLower(ev.Action) {
    case "opened", "synchronize", "synchronized", "reopened", "open", "reopen", "update":
    default:
        return
    }
    token := resolveToken(ctx, h.gitbotUsecase, bot, h.logger)
    if token == "" {
        return
    }
    if !dedup(ctx, h.redis, ev.URL, h.logger) {
        return
    }
    h.gitTaskUsecase.Create(ctx, domain.CreateGitTaskReq{
        HostID:   bot.Host.ID,
        ImageID:  uuid.MustParse(h.cfg.Task.ImageID),
        Prompt:   ev.URL,
        Git:      taskflow.Git{Token: token},
        Subject:  domain.Subject{ID: fmt.Sprintf("%d", ev.ID), Type: "PullRequest", Title: ev.Title, URL: ev.URL, Number: ev.Number},
        Repo:     ev.Repo,
        Platform: s.Platform(),
        User:     ev.User,
        Body:     ev.Body,
        Time:     time.Now(),
        Env:      map[string]string{s.TokenEnvKey(): token},
        Bot:      bot,
    })
}
```

**各平台策略实现**（轻量文件）：

- `webhook_strategy_github.go` — HMAC-SHA256 验证，`X-Github-Event` 头，解析 GitHub PR payload
- `webhook_strategy_gitlab.go` — Token 直接比对，`X-Gitlab-Event` 头，解析 GitLab MR payload
- `webhook_strategy_gitea.go` — HMAC-SHA256 验证，`X-Gitea-Event` 头，解析 Gitea PR payload

**路由注册**（保持 API 兼容）：

```go
w.Group("/api/v1").POST("/github/webhook/:id", web.BaseHandler(h.Handle(githubStrategy)))
w.Group("/api/v1").POST("/gitlab/webhook/:id", web.BaseHandler(h.Handle(gitlabStrategy)))
w.Group("/api/v1").POST("/gitea/webhook/:id", web.BaseHandler(h.Handle(giteaStrategy)))
```

## 文件变更清单

### 新增
- `domain/gitplatform.go` — 统一类型 + 接口 + Options 定义
- `biz/git/handler/v1/webhook.go` — 统一 webhook handler
- `biz/git/handler/v1/webhook_strategy.go` — WebhookStrategy 接口 + PREvent
- `biz/git/handler/v1/webhook_strategy_github.go`
- `biz/git/handler/v1/webhook_strategy_gitlab.go`
- `biz/git/handler/v1/webhook_strategy_gitea.go`

### 修改
- `pkg/git/github/github.go` — 实现 `GitPlatformClient`，返回 domain 类型
- `pkg/git/github/operation.go` — 方法签名改为接口方法，返回 domain 类型
- `pkg/git/gitlab/gitlab.go` — 同上
- `pkg/git/gitlab/operation.go` — 同上
- `pkg/git/gitea/gitea.go` — 同上
- `pkg/git/gitea/operation.go` — 同上
- `biz/project/usecase/project.go` — 用 `getClient()` 工厂替代 switch，删除 4 个 xxxLogsToProjectLogs
- `biz/git/usecase/identity.go` — 使用新接口
- `domain/gitidentity.go` — 删除旧的 `GitPlatformClient[T]` 和 `AuthRepositoryInterface`

### 删除
- `pkg/git/github/types.go`
- `pkg/git/gitlab/types.go`
- `pkg/git/gitea/types.go`
- `biz/git/handler/v1/webhook_github.go`
- `biz/git/handler/v1/webhook_gitlab.go`
- `biz/git/handler/v1/webhook_gitea.go`

## 兼容性

- API 路由路径不变
- Webhook 签名验证逻辑不变
- 外部行为无变化
- Gitee 平台同样适用此抽象，可在后续统一接入
