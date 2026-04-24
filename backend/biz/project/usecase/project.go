package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/patrickmn/go-cache"
	"github.com/samber/do"

	gituc "github.com/chaitin/MonkeyCode/backend/biz/git/usecase"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitea"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitee"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/github"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitlab"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/giturl"
)

// repoTokenCacheTTL 仓库 token 缓存过期时间
const repoTokenCacheTTL = 3600 * time.Second

// ProjectUsecase 项目业务逻辑层
type ProjectUsecase struct {
	repo            domain.ProjectRepo
	gitidentityRepo domain.GitIdentityRepo
	gitidentityUC   domain.GitIdentityUsecase
	logger          *slog.Logger
	cfg             *config.Config
	gh              *github.Github
	gte             *gitee.Gitee
	gta             *gitea.Gitea
	glDomestic      *gitlab.Gitlab
	glInternational *gitlab.Gitlab
	tokenCache      *cache.Cache
	tokenProvider   *gituc.TokenProvider
}

// NewProjectUsecase 创建项目业务逻辑层实例
func NewProjectUsecase(i *do.Injector) (domain.ProjectUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	logger := do.MustInvoke[*slog.Logger](i)

	var glDomestic *gitlab.Gitlab
	if baseURL := cfg.GetGitlabBaseURL("domestic"); baseURL != "" {
		glDomestic = gitlab.NewGitlab(baseURL, cfg.GetGitlabToken("domestic"), logger)
	}
	var glInternational *gitlab.Gitlab
	if baseURL := cfg.GetGitlabBaseURL("international"); baseURL != "" {
		glInternational = gitlab.NewGitlab(baseURL, cfg.GetGitlabToken("international"), logger)
	}

	return &ProjectUsecase{
		repo:            do.MustInvoke[domain.ProjectRepo](i),
		gitidentityRepo: do.MustInvoke[domain.GitIdentityRepo](i),
		gitidentityUC:   do.MustInvoke[domain.GitIdentityUsecase](i),
		logger:          logger.With("module", "usecase.ProjectUsecase"),
		cfg:             cfg,
		gh:              github.NewGithub(logger, cfg),
		gte:             gitee.NewGitee(cfg.Gitee.BaseURL, logger),
		gta:             gitea.NewGitea(logger, cfg.GetGiteaBaseURL()),
		glDomestic:      glDomestic,
		glInternational: glInternational,
		tokenCache:      cache.New(repoTokenCacheTTL, 10*time.Minute),
		tokenProvider:   do.MustInvoke[*gituc.TokenProvider](i),
	}, nil
}

// getGitlabClientByBaseURL 返回匹配的 GitLab 客户端
func (u *ProjectUsecase) getGitlabClientByBaseURL(baseURL string) *gitlab.Gitlab {
	baseURL = strings.TrimSuffix(baseURL, "/")
	if u.glDomestic != nil && strings.TrimSuffix(u.cfg.GetGitlabBaseURL("domestic"), "/") == baseURL {
		return u.glDomestic
	}
	if u.glInternational != nil && strings.TrimSuffix(u.cfg.GetGitlabBaseURL("international"), "/") == baseURL {
		return u.glInternational
	}
	return gitlab.NewGitlabForBaseURL(baseURL, u.logger)
}

// Get 获取项目
func (u *ProjectUsecase) Get(ctx context.Context, uid, id uuid.UUID) (*domain.Project, error) {
	p, err := u.repo.Get(ctx, uid, id)
	if err != nil {
		return nil, err
	}
	return cvt.From(p, &domain.Project{}), nil
}

// List 列出用户的所有项目
func (u *ProjectUsecase) List(ctx context.Context, uid uuid.UUID, cursor domain.CursorReq) (*domain.ListProjectResp, error) {
	ps, cur, err := u.repo.List(ctx, uid, cursor)
	if err != nil {
		return nil, err
	}
	return &domain.ListProjectResp{
		Projects: cvt.Iter(ps, func(_ int, p *db.Project) *domain.Project {
			return cvt.From(p, &domain.Project{})
		}),
		Page: cur,
	}, nil
}

// Create 创建项目
func (u *ProjectUsecase) Create(ctx context.Context, uid uuid.UUID, req *domain.CreateProjectReq) (*domain.Project, error) {
	p, err := u.repo.Create(ctx, uid, req)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to create project", "error", err)
		return nil, err
	}
	return cvt.From(p, &domain.Project{}), nil
}

// Update 更新项目
func (u *ProjectUsecase) Update(ctx context.Context, user *domain.User, req *domain.UpdateProjectReq) (*domain.Project, error) {
	p, err := u.repo.Update(ctx, user, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(p, &domain.Project{}), nil
}

// Delete 删除项目
func (u *ProjectUsecase) Delete(ctx context.Context, uid, id uuid.UUID) error {
	return u.repo.Delete(ctx, uid, id)
}

// ListIssues 列出项目问题
func (u *ProjectUsecase) ListIssues(ctx context.Context, uid uuid.UUID, req *domain.ListIssuesReq) (*domain.ListIssuesResp, error) {
	issues, cur, err := u.repo.ListIssues(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return &domain.ListIssuesResp{
		Issues: cvt.Iter(issues, func(_ int, i *db.ProjectIssue) *domain.ProjectIssue {
			return cvt.From(i, &domain.ProjectIssue{})
		}),
		Page: cur,
	}, nil
}

// CreateIssue 创建问题
func (u *ProjectUsecase) CreateIssue(ctx context.Context, uid uuid.UUID, req *domain.CreateIssueReq) (*domain.ProjectIssue, error) {
	issue, err := u.repo.CreateIssue(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(issue, &domain.ProjectIssue{}), nil
}

// UpdateIssue 更新问题
func (u *ProjectUsecase) UpdateIssue(ctx context.Context, uid uuid.UUID, req *domain.UpdateIssueReq) (*domain.ProjectIssue, error) {
	issue, err := u.repo.UpdateIssue(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(issue, &domain.ProjectIssue{}), nil
}

// DeleteIssue 删除问题
func (u *ProjectUsecase) DeleteIssue(ctx context.Context, uid uuid.UUID, req *domain.DeleteIssueReq) error {
	return u.repo.DeleteIssue(ctx, uid, req)
}

// UpdateIssueDoc 更新问题文档
func (u *ProjectUsecase) UpdateIssueDoc(ctx context.Context, req *domain.UpdateIssueDocReq) (*domain.ProjectIssue, error) {
	issue, err := u.repo.UpdateIssueDoc(ctx, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(issue, &domain.ProjectIssue{}), nil
}

// ListCollaborators 列出项目协作者
func (u *ProjectUsecase) ListCollaborators(ctx context.Context, uid uuid.UUID, req *domain.ListCollaboratorsReq) (*domain.ListCollaboratorsResp, error) {
	collaborators, err := u.repo.ListCollaborators(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return &domain.ListCollaboratorsResp{
		Collaborators: cvt.Iter(collaborators, func(_ int, c *db.ProjectCollaborator) *domain.Collaborator {
			return cvt.From(c, &domain.Collaborator{})
		}),
	}, nil
}

// ListIssueComments 列出问题评论
func (u *ProjectUsecase) ListIssueComments(ctx context.Context, uid uuid.UUID, req *domain.ListIssueCommentsReq) (*domain.ListIssueCommentsResp, error) {
	if req.Limit <= 0 {
		req.Limit = 100
	}
	comments, cur, err := u.repo.ListIssueComments(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	commentMap := make(map[uuid.UUID]*domain.ProjectIssueComment)
	var rootComments []*domain.ProjectIssueComment
	for _, c := range comments {
		comment := cvt.From(c, &domain.ProjectIssueComment{})
		if c.Edges.Parent == nil {
			comment.Parent = nil
			rootComments = append(rootComments, comment)
		}
		commentMap[comment.ID] = comment
	}
	for _, c := range comments {
		if c.Edges.Parent != nil {
			parentID := c.Edges.Parent.ID
			if parent, ok := commentMap[parentID]; ok {
				child := commentMap[c.ID]
				child.Parent = &domain.ProjectIssueComment{
					ID:      parent.ID,
					Comment: parent.Comment,
					Creator: parent.Creator,
				}
				parent.Replies = append(parent.Replies, child)
			}
		}
	}
	return &domain.ListIssueCommentsResp{
		Comments: rootComments,
		Page:     cur,
	}, nil
}

// CreateIssueComment 创建问题评论
func (u *ProjectUsecase) CreateIssueComment(ctx context.Context, uid uuid.UUID, req *domain.CreateIssueCommentReq) (*domain.ProjectIssueComment, error) {
	comment, err := u.repo.CreateIssueComment(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(comment, &domain.ProjectIssueComment{}), nil
}

// GetProjectIDByTask 根据 task_id 获取项目
func (u *ProjectUsecase) GetProjectIDByTask(ctx context.Context, taskID string) (*domain.Project, error) {
	p, err := u.repo.GetProjectIDByTask(ctx, taskID)
	if err != nil {
		return nil, err
	}
	return cvt.From(p, &domain.Project{}), nil
}

// GetIssueByTaskID 根据 task_id 获取 issue
func (u *ProjectUsecase) GetIssueByTaskID(ctx context.Context, taskID string) (*domain.ProjectIssue, error) {
	issue, err := u.repo.GetIssueByTaskID(ctx, taskID)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get issue by task id", "error", err)
		return nil, err
	}
	return cvt.From(issue, &domain.ProjectIssue{}), nil
}

// ClientContext 客户端上下文
type ClientContext struct {
	Owner         string
	Repo          string
	DefaultBranch string
	InstallID     int64
	Token         string
	IsOAuth       bool
}

// getClient 获取平台客户端和上下文
func (u *ProjectUsecase) getClient(p *db.Project) (domain.GitClienter, *ClientContext, error) {
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
			Owner: projectPath, DefaultBranch: p.Branch, Token: token, IsOAuth: gi.OauthRefreshToken != "",
		}, nil

	case consts.GitPlatformGitea:
		owner, repo, _ := gitea.ParseRepoPath(p.RepoURL)
		baseURL := gi.BaseURL
		if baseURL == "" {
			baseURL = u.cfg.GetGiteaBaseURL()
		}
		client := gitea.NewGitea(u.logger, baseURL)
		return client, &ClientContext{
			Owner: owner, Repo: repo, DefaultBranch: p.Branch, Token: token, IsOAuth: gi.OauthRefreshToken != "",
		}, nil

	case consts.GitPlatformGitee:
		owner, repo, _ := gitee.ParseRepoPath(p.RepoURL)
		return u.gte, &ClientContext{
			Owner: owner, Repo: repo, DefaultBranch: p.Branch, Token: token, IsOAuth: gi.OauthRefreshToken != "",
		}, nil

	default:
		return nil, nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("unsupported platform: %s", p.Platform))
	}
}

// getRepoToken 获取平台 token
func (u *ProjectUsecase) getRepoToken(p *db.Project) (string, error) {
	gi := p.Edges.GitIdentity
	if gi == nil {
		return "", errcode.ErrGitOperation.Wrap(fmt.Errorf("project has no git identity"))
	}
	return gi.AccessToken, nil
}

// GetProjectTree 获取项目仓库树
func (u *ProjectUsecase) GetProjectTree(ctx context.Context, uid uuid.UUID, req *domain.GetProjectTreeReq) (domain.ProjectTree, error) {
	p, err := u.repo.Get(ctx, uid, req.ID)
	if err != nil {
		return nil, err
	}
	client, cctx, err := u.getClient(p)
	if err != nil {
		return nil, err
	}

	ref := req.Ref
	if ref == "" {
		ref = cctx.DefaultBranch
	}
	treeResp, err := client.Tree(ctx, &domain.TreeOptions{
		Token: cctx.Token, Owner: cctx.Owner, Repo: cctx.Repo,
		Ref: ref, Path: req.Path, Recursive: req.Recursive,
		InstallID: cctx.InstallID, IsOAuth: cctx.IsOAuth,
	})
	if err != nil {
		return nil, errcode.ErrGitOperation.Wrap(err)
	}
	return cvt.Iter(treeResp.Entries, func(_ int, e *domain.TreeEntry) *domain.ProjectTreeEntry {
		return &domain.ProjectTreeEntry{Mode: e.Mode, Name: e.Name, Path: e.Path, Sha: e.Sha, Size: e.Size, LastModifiedAt: e.LastModifiedAt}
	}), nil
}

// GetProjectBlob 获取项目文件内容
func (u *ProjectUsecase) GetProjectBlob(ctx context.Context, uid uuid.UUID, req *domain.GetProjectBlobReq) (*domain.ProjectBlob, error) {
	p, err := u.repo.Get(ctx, uid, req.ID)
	if err != nil {
		return nil, err
	}
	client, cctx, err := u.getClient(p)
	if err != nil {
		return nil, err
	}

	ref := req.Ref
	if ref == "" {
		ref = cctx.DefaultBranch
	}
	resp, err := client.Blob(ctx, &domain.BlobOptions{
		Token: cctx.Token, Owner: cctx.Owner, Repo: cctx.Repo,
		Ref: ref, Path: req.Path,
		InstallID: cctx.InstallID, IsOAuth: cctx.IsOAuth,
	})
	if err != nil {
		return nil, errcode.ErrGitOperation.Wrap(err)
	}
	return &domain.ProjectBlob{Content: resp.Content, IsBinary: resp.IsBinary, Sha: resp.Sha, Size: resp.Size}, nil
}

// commitEntryToDomain 将平台 commit entry 转为 domain
func commitEntryToDomain(sha, message, treeSha string, parentShas []string, author, committer *domain.CommitUserAdapter) *domain.ProjectCommitEntry {
	entry := &domain.ProjectCommitEntry{
		Commit: &domain.ProjectCommit{
			Sha:        sha,
			Message:    message,
			TreeSha:    treeSha,
			ParentShas: parentShas,
		},
	}
	if author != nil {
		entry.Commit.Author = cvt.From(author, &domain.ProjectCommitUser{})
	}
	if committer != nil {
		entry.Commit.Committer = cvt.From(committer, &domain.ProjectCommitUser{})
	}
	return entry
}

// GetProjectLogs 获取项目仓库日志
func (u *ProjectUsecase) GetProjectLogs(ctx context.Context, uid uuid.UUID, req *domain.GetProjectLogsReq) (*domain.ProjectLogs, error) {
	p, err := u.repo.Get(ctx, uid, req.ID)
	if err != nil {
		return nil, err
	}
	client, cctx, err := u.getClient(p)
	if err != nil {
		return nil, err
	}

	ref := req.Ref
	if ref == "" {
		ref = cctx.DefaultBranch
	}
	resp, err := client.Logs(ctx, &domain.LogsOptions{
		Token: cctx.Token, Owner: cctx.Owner, Repo: cctx.Repo,
		Ref: ref, Path: req.Path, Limit: req.Limit, Offset: req.Offset,
		InstallID: cctx.InstallID, IsOAuth: cctx.IsOAuth,
	})
	if err != nil {
		return nil, errcode.ErrGitOperation.Wrap(err)
	}
	return logsToProjectLogs(resp), nil
}

func logsToProjectLogs(resp *domain.GetGitLogsResp) *domain.ProjectLogs {
	return &domain.ProjectLogs{
		Count: resp.Count,
		Entries: cvt.Iter(resp.Entries, func(_ int, e *domain.GitCommitEntry) *domain.ProjectCommitEntry {
			c := e.Commit
			var author, committer *domain.CommitUserAdapter
			if c.Author != nil {
				author = &domain.CommitUserAdapter{Email: c.Author.Email, Name: c.Author.Name, When: c.Author.When}
			}
			if c.Committer != nil {
				committer = &domain.CommitUserAdapter{Email: c.Committer.Email, Name: c.Committer.Name, When: c.Committer.When}
			}
			return commitEntryToDomain(c.Sha, c.Message, c.TreeSha, c.ParentShas, author, committer)
		}),
	}
}

// GetProjectArchive 获取项目仓库压缩包
func (u *ProjectUsecase) GetProjectArchive(ctx context.Context, uid uuid.UUID, req *domain.GetProjectArchiveReq) (*domain.GetProjectArchiveResp, error) {
	p, err := u.repo.Get(ctx, uid, req.ID)
	if err != nil {
		return nil, err
	}
	client, cctx, err := u.getClient(p)
	if err != nil {
		return nil, err
	}

	ref := req.Ref
	if ref == "" {
		ref = cctx.DefaultBranch
	}
	resp, err := client.Archive(ctx, &domain.ArchiveOptions{
		Token: cctx.Token, Owner: cctx.Owner, Repo: cctx.Repo, Ref: ref,
		InstallID: cctx.InstallID, IsOAuth: cctx.IsOAuth,
	})
	if err != nil {
		return nil, errcode.ErrGitOperation.Wrap(err)
	}
	return &domain.GetProjectArchiveResp{ContentLength: resp.ContentLength, ContentType: resp.ContentType, Reader: resp.Reader}, nil
}

// GetRepoToken 根据 platform 统一获取仓库 token
func (u *ProjectUsecase) GetRepoToken(ctx context.Context, userID, projectID, gitIdentityID uuid.UUID, platform consts.GitPlatform) (string, error) {
	if u.tokenProvider != nil {
		return u.tokenProvider.GetToken(ctx, gitIdentityID)
	}
	// fallback: 直接读 DB
	gi, err := u.gitidentityRepo.Get(ctx, gitIdentityID)
	if err != nil {
		if db.IsNotFound(err) {
			return "", errcode.ErrNotFound
		}
		return "", errcode.ErrDatabaseOperation.Wrap(err)
	}
	return gi.AccessToken, nil
}
