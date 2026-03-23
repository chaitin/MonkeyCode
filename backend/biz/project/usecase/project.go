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
		gh:              github.NewGithub(logger),
		gte:             gitee.NewGitee(cfg.Gitee.BaseURL, logger),
		gta:             gitea.NewGitea(logger, cfg.GetGiteaBaseURL()),
		glDomestic:      glDomestic,
		glInternational: glInternational,
		tokenCache:      cache.New(repoTokenCacheTTL, 10*time.Minute),
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
// gitlabProjectInfo GitLab 项目信息
type gitlabProjectInfo struct {
	client        *gitlab.Gitlab
	projectPath   string
	defaultBranch string
	isOAuth       bool
}

// getGitlabProjectInfo 获取 GitLab 项目信息
func (u *ProjectUsecase) getGitlabProjectInfo(p *db.Project) *gitlabProjectInfo {
	if p.Platform != consts.GitPlatformGitLab {
		return nil
	}
	gi := p.Edges.GitIdentity
	if gi == nil {
		return nil
	}
	projectPath, err := gitlab.ParseProjectPath(p.RepoURL)
	if err != nil {
		return nil
	}
	client := u.getGitlabClientByBaseURL(gi.BaseURL)
	if client == nil {
		return nil
	}
	isOAuth := gi.OauthRefreshToken != ""
	defaultBranch := p.Branch
	if defaultBranch == "" {
		defaultBranch = "main"
	}
	return &gitlabProjectInfo{
		client:        client,
		projectPath:   projectPath,
		defaultBranch: defaultBranch,
		isOAuth:       isOAuth,
	}
}

// githubProjectInfo GitHub 项目信息
type githubProjectInfo struct {
	owner         string
	repo          string
	defaultBranch string
}

// getGithubInfo 获取 GitHub 项目信息
func getGithubInfo(p *db.Project) *githubProjectInfo {
	if p.Platform != consts.GitPlatformGithub {
		return nil
	}
	parsed, err := giturl.Parse(p.RepoURL)
	if err != nil {
		return nil
	}
	defaultBranch := p.Branch
	if defaultBranch == "" {
		defaultBranch = "main"
	}
	return &githubProjectInfo{
		owner:         parsed.Owner,
		repo:          parsed.Repo,
		defaultBranch: defaultBranch,
	}
}
// giteeProjectInfo Gitee 项目信息
type giteeProjectInfo struct {
	owner         string
	repo          string
	defaultBranch string
	isOAuth       bool
}

func getGiteeProjectInfo(p *db.Project) *giteeProjectInfo {
	if p.Platform != consts.GitPlatformGitee {
		return nil
	}
	owner, repo, err := gitee.ParseRepoPath(p.RepoURL)
	if err != nil {
		return nil
	}
	defaultBranch := p.Branch
	if defaultBranch == "" {
		defaultBranch = "master"
	}
	isOAuth := p.Edges.GitIdentity != nil && p.Edges.GitIdentity.OauthRefreshToken != ""
	return &giteeProjectInfo{owner: owner, repo: repo, defaultBranch: defaultBranch, isOAuth: isOAuth}
}

// giteaProjectInfo Gitea 项目信息
type giteaProjectInfo struct {
	baseURL       string
	owner         string
	repo          string
	defaultBranch string
	isOAuth       bool
}

func (u *ProjectUsecase) getGiteaProjectInfo(p *db.Project) *giteaProjectInfo {
	if p.Platform != consts.GitPlatformGitea {
		return nil
	}
	owner, repo, err := gitea.ParseRepoPath(p.RepoURL)
	if err != nil {
		return nil
	}
	defaultBranch := p.Branch
	if defaultBranch == "" {
		defaultBranch = "master"
	}
	baseURL := ""
	gi := p.Edges.GitIdentity
	if gi != nil {
		baseURL = gi.BaseURL
	}
	if baseURL == "" {
		baseURL = u.cfg.GetGiteaBaseURL()
	}
	isOAuth := gi != nil && gi.OauthRefreshToken != ""
	return &giteaProjectInfo{baseURL: baseURL, owner: owner, repo: repo, defaultBranch: defaultBranch, isOAuth: isOAuth}
}

// getRepoToken 获取平台 token
func (u *ProjectUsecase) getRepoToken(ctx context.Context, p *db.Project) (string, error) {
	gi := p.Edges.GitIdentity
	if gi == nil {
		return "", errcode.ErrGitOperation.Wrap(fmt.Errorf("project has no git identity"))
	}
	return gi.AccessToken, nil
}
// treeEntryToAdapter 将 github TreeEntry 转为 domain adapter
func githubTreeEntryToAdapter(e *github.TreeEntry) *domain.TreeEntryAdapter {
	return &domain.TreeEntryAdapter{Mode: e.Mode, Name: e.Name, Path: e.Path, Sha: e.Sha, Size: e.Size, LastModifiedAt: e.LastModifiedAt}
}

// GetProjectTree 获取项目仓库树
func (u *ProjectUsecase) GetProjectTree(ctx context.Context, uid uuid.UUID, req *domain.GetProjectTreeReq) (domain.ProjectTree, error) {
	p, err := u.repo.Get(ctx, uid, req.ID)
	if err != nil {
		return nil, err
	}
	token, err := u.getRepoToken(ctx, p)
	if err != nil {
		return nil, err
	}

	switch p.Platform {
	case consts.GitPlatformGithub:
		ghInfo := getGithubInfo(p)
		if ghInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("github project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = ghInfo.defaultBranch
		}
		treeResp, err := u.gh.GetRepoTree(ctx, token, ghInfo.owner, ghInfo.repo, ref, req.Path, req.Recursive)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return cvt.Iter(treeResp.Entries, func(_ int, e *github.TreeEntry) *domain.ProjectTreeEntry {
			return cvt.From(githubTreeEntryToAdapter(e), &domain.ProjectTreeEntry{})
		}), nil

	case consts.GitPlatformGitLab:
		glInfo := u.getGitlabProjectInfo(p)
		if glInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitlab project missing identity or client"))
		}
		ref := req.Ref
		if ref == "" {
			ref = glInfo.defaultBranch
		}
		treeResp, err := glInfo.client.GetRepoTree(ctx, token, glInfo.projectPath, ref, req.Path, req.Recursive, glInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return cvt.Iter(treeResp.Entries, func(_ int, e *gitlab.TreeEntry) *domain.ProjectTreeEntry {
			return &domain.ProjectTreeEntry{Mode: e.Mode, Name: e.Name, Path: e.Path, Sha: e.Sha, Size: e.Size}
		}), nil

	case consts.GitPlatformGitee:
		geInfo := getGiteeProjectInfo(p)
		if geInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitee project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = geInfo.defaultBranch
		}
		treeResp, err := u.gte.GetRepoTree(ctx, token, geInfo.owner, geInfo.repo, ref, req.Path, req.Recursive, geInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return cvt.Iter(treeResp.Entries, func(_ int, e *gitee.TreeEntry) *domain.ProjectTreeEntry {
			return &domain.ProjectTreeEntry{Mode: e.Mode, Name: e.Name, Path: e.Path, Sha: e.Sha, Size: e.Size}
		}), nil

	case consts.GitPlatformGitea:
		gtaInfo := u.getGiteaProjectInfo(p)
		if gtaInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitea project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = gtaInfo.defaultBranch
		}
		treeResp, err := u.gta.GetRepoTree(ctx, gtaInfo.baseURL, token, gtaInfo.owner, gtaInfo.repo, ref, req.Path, req.Recursive, gtaInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return cvt.Iter(treeResp.Entries, func(_ int, e *gitea.TreeEntry) *domain.ProjectTreeEntry {
			return &domain.ProjectTreeEntry{Mode: e.Mode, Name: e.Name, Path: e.Path, Sha: e.Sha, Size: e.Size}
		}), nil

	default:
		return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("unsupported platform: %s", p.Platform))
	}
}
// GetProjectBlob 获取项目文件内容
func (u *ProjectUsecase) GetProjectBlob(ctx context.Context, uid uuid.UUID, req *domain.GetProjectBlobReq) (*domain.ProjectBlob, error) {
	p, err := u.repo.Get(ctx, uid, req.ID)
	if err != nil {
		return nil, err
	}
	token, err := u.getRepoToken(ctx, p)
	if err != nil {
		return nil, err
	}

	switch p.Platform {
	case consts.GitPlatformGithub:
		ghInfo := getGithubInfo(p)
		if ghInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("github project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = ghInfo.defaultBranch
		}
		resp, err := u.gh.GetBlob(ctx, token, ghInfo.owner, ghInfo.repo, ref, req.Path)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.ProjectBlob{Content: resp.Content, IsBinary: resp.IsBinary, Sha: resp.Sha, Size: resp.Size}, nil

	case consts.GitPlatformGitLab:
		glInfo := u.getGitlabProjectInfo(p)
		if glInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitlab project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = glInfo.defaultBranch
		}
		resp, err := glInfo.client.GetBlob(ctx, token, glInfo.projectPath, ref, req.Path, glInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.ProjectBlob{Content: resp.Content, IsBinary: resp.IsBinary, Sha: resp.Sha, Size: resp.Size}, nil

	case consts.GitPlatformGitee:
		geInfo := getGiteeProjectInfo(p)
		if geInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitee project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = geInfo.defaultBranch
		}
		resp, err := u.gte.GetBlob(ctx, token, geInfo.owner, geInfo.repo, ref, req.Path, geInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.ProjectBlob{Content: resp.Content, IsBinary: resp.IsBinary, Sha: resp.Sha, Size: resp.Size}, nil

	case consts.GitPlatformGitea:
		gtaInfo := u.getGiteaProjectInfo(p)
		if gtaInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitea project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = gtaInfo.defaultBranch
		}
		resp, err := u.gta.GetBlob(ctx, gtaInfo.baseURL, token, gtaInfo.owner, gtaInfo.repo, ref, req.Path, gtaInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.ProjectBlob{Content: resp.Content, IsBinary: resp.IsBinary, Sha: resp.Sha, Size: resp.Size}, nil

	default:
		return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("unsupported platform: %s", p.Platform))
	}
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
	token, err := u.getRepoToken(ctx, p)
	if err != nil {
		return nil, err
	}

	switch p.Platform {
	case consts.GitPlatformGithub:
		ghInfo := getGithubInfo(p)
		if ghInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("github project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = ghInfo.defaultBranch
		}
		resp, err := u.gh.GetGitLogs(ctx, token, ghInfo.owner, ghInfo.repo, ref, req.Path, req.Limit, req.Offset)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return githubLogsToProjectLogs(resp), nil

	case consts.GitPlatformGitLab:
		glInfo := u.getGitlabProjectInfo(p)
		if glInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitlab project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = glInfo.defaultBranch
		}
		resp, err := glInfo.client.GetGitLogs(ctx, token, glInfo.projectPath, ref, req.Path, req.Limit, req.Offset, glInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return gitlabLogsToProjectLogs(resp), nil

	case consts.GitPlatformGitee:
		geInfo := getGiteeProjectInfo(p)
		if geInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitee project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = geInfo.defaultBranch
		}
		resp, err := u.gte.GetGitLogs(ctx, token, geInfo.owner, geInfo.repo, ref, req.Path, req.Limit, req.Offset, geInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return giteeLogsToProjectLogs(resp), nil

	case consts.GitPlatformGitea:
		gtaInfo := u.getGiteaProjectInfo(p)
		if gtaInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitea project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = gtaInfo.defaultBranch
		}
		resp, err := u.gta.GetGitLogs(ctx, gtaInfo.baseURL, token, gtaInfo.owner, gtaInfo.repo, ref, req.Path, req.Limit, req.Offset, gtaInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return giteaLogsToProjectLogs(resp), nil

	default:
		return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("unsupported platform: %s", p.Platform))
	}
}
func githubLogsToProjectLogs(resp *github.GetGitLogsResp) *domain.ProjectLogs {
	return &domain.ProjectLogs{
		Count: resp.Count,
		Entries: cvt.Iter(resp.Entries, func(_ int, e *github.GitCommitEntry) *domain.ProjectCommitEntry {
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

func gitlabLogsToProjectLogs(resp *gitlab.GetGitLogsResp) *domain.ProjectLogs {
	return &domain.ProjectLogs{
		Count: resp.Count,
		Entries: cvt.Iter(resp.Entries, func(_ int, e *gitlab.GitCommitEntry) *domain.ProjectCommitEntry {
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

func giteeLogsToProjectLogs(resp *gitee.GetGitLogsResp) *domain.ProjectLogs {
	return &domain.ProjectLogs{
		Count: resp.Count,
		Entries: cvt.Iter(resp.Entries, func(_ int, e *gitee.GitCommitEntry) *domain.ProjectCommitEntry {
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

func giteaLogsToProjectLogs(resp *gitea.GetGitLogsResp) *domain.ProjectLogs {
	return &domain.ProjectLogs{
		Count: resp.Count,
		Entries: cvt.Iter(resp.Entries, func(_ int, e *gitea.GitCommitEntry) *domain.ProjectCommitEntry {
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
	token, err := u.getRepoToken(ctx, p)
	if err != nil {
		return nil, err
	}

	switch p.Platform {
	case consts.GitPlatformGithub:
		ghInfo := getGithubInfo(p)
		if ghInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("github project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = ghInfo.defaultBranch
		}
		resp, err := u.gh.GetRepoArchive(ctx, token, ghInfo.owner, ghInfo.repo, ref)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.GetProjectArchiveResp{ContentLength: resp.ContentLength, ContentType: resp.ContentType, Reader: resp.Reader}, nil

	case consts.GitPlatformGitLab:
		glInfo := u.getGitlabProjectInfo(p)
		if glInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitlab project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = glInfo.defaultBranch
		}
		resp, err := glInfo.client.GetRepoArchive(ctx, token, glInfo.projectPath, ref, glInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.GetProjectArchiveResp{ContentLength: resp.ContentLength, ContentType: resp.ContentType, Reader: resp.Reader}, nil

	case consts.GitPlatformGitee:
		geInfo := getGiteeProjectInfo(p)
		if geInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitee project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = geInfo.defaultBranch
		}
		resp, err := u.gte.GetRepoArchive(ctx, token, geInfo.owner, geInfo.repo, ref, geInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.GetProjectArchiveResp{ContentLength: resp.ContentLength, ContentType: resp.ContentType, Reader: resp.Reader}, nil

	case consts.GitPlatformGitea:
		gtaInfo := u.getGiteaProjectInfo(p)
		if gtaInfo == nil {
			return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("gitea project missing info"))
		}
		ref := req.Ref
		if ref == "" {
			ref = gtaInfo.defaultBranch
		}
		resp, err := u.gta.GetRepoArchive(ctx, gtaInfo.baseURL, token, gtaInfo.owner, gtaInfo.repo, ref, gtaInfo.isOAuth)
		if err != nil {
			return nil, errcode.ErrGitOperation.Wrap(err)
		}
		return &domain.GetProjectArchiveResp{ContentLength: resp.ContentLength, ContentType: resp.ContentType, Reader: resp.Reader}, nil

	default:
		return nil, errcode.ErrGitOperation.Wrap(fmt.Errorf("unsupported platform: %s", p.Platform))
	}
}

// GetRepoToken 根据 platform 统一获取仓库 token
func (u *ProjectUsecase) GetRepoToken(ctx context.Context, userID, projectID, gitIdentityID uuid.UUID, platform consts.GitPlatform) (string, error) {
	gi, err := u.gitidentityRepo.Get(ctx, gitIdentityID)
	if err != nil {
		if db.IsNotFound(err) {
			return "", errcode.ErrNotFound
		}
		return "", errcode.ErrDatabaseOperation.Wrap(err)
	}
	return gi.AccessToken, nil
}
