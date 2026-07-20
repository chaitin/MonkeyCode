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
	gitpkg "github.com/chaitin/MonkeyCode/backend/pkg/git"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/atomgit"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/cnb"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/codeup"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitea"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitee"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/github"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitlab"
	"github.com/chaitin/MonkeyCode/backend/pkg/netguard"
)

// GitIdentityUsecase Git 身份认证用例
type GitIdentityUsecase struct {
	cfg           *config.Config
	repo          domain.GitIdentityRepo
	tokenProvider *TokenProvider
	logger        *slog.Logger
	repoCache     *cache.Cache
	guard         *netguard.Guard
}

// NewGitIdentityUsecase 创建 Git 身份认证用例
func NewGitIdentityUsecase(i *do.Injector) (domain.GitIdentityUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	return &GitIdentityUsecase{
		cfg:           cfg,
		repo:          do.MustInvoke[domain.GitIdentityRepo](i),
		tokenProvider: do.MustInvoke[*TokenProvider](i),
		logger:        do.MustInvoke[*slog.Logger](i).With("module", "GitIdentityUsecase"),
		repoCache:     cache.New(7*24*time.Hour, 10*time.Minute),
		guard:         netguard.New(cfg.Security.BlockPrivateNetwork),
	}, nil
}

// List 获取用户的 Git 身份认证列表
func (u *GitIdentityUsecase) List(ctx context.Context, uid uuid.UUID) ([]*domain.GitIdentity, error) {
	identities, err := u.repo.List(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to list git identities", "error", err, "user_id", uid)
		return nil, err
	}
	return cvt.Iter(identities, func(_ int, identity *db.GitIdentity) *domain.GitIdentity {
		return cvt.From(identity, &domain.GitIdentity{})
	}), nil
}

func (u *GitIdentityUsecase) gitClienter(identity *db.GitIdentity) domain.GitClienter {
	var inner domain.GitClienter
	switch identity.Platform {
	case consts.GitPlatformGithub:
		inner = github.NewGithub(u.logger, u.cfg)
	case consts.GitPlatformGitLab:
		inner = gitlab.NewGitlabForBaseURL(identity.BaseURL, u.logger)
	case consts.GitPlatformGitea:
		inner = gitea.NewGitea(u.logger, identity.BaseURL)
	case consts.GitPlatformGitee:
		inner = gitee.NewGitee(identity.BaseURL, u.logger)
	case consts.GitPlatformCodeup:
		inner = codeup.NewCodeup(identity.BaseURL, identity.OrganizationID, u.logger)
	case consts.GitPlatformCnb:
		inner = cnb.NewCnb(identity.BaseURL, u.logger)
	case consts.GitPlatformAtomgit:
		inner = atomgit.NewAtomgit(identity.BaseURL, u.logger)
	default:
		return nil
	}
	return gitpkg.NewCachedGitClient(inner, u.repoCache, identity.UserID.String()+":"+identity.ID.String())
}

// prefetchRepositories 异步预拉取仓库列表以预热缓存
func (u *GitIdentityUsecase) prefetchRepositories(identity *db.GitIdentity) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				u.logger.Warn("prefetch: panic recovered", "error", r, "identity_id", identity.ID)
			}
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		if _, err := u.fetchRepositories(ctx, identity, false, 0, 0, ""); err != nil {
			u.logger.WarnContext(ctx, "prefetch: failed to fetch repositories", "error", err, "identity_id", identity.ID)
		}
	}()
}

// fetchRepositories 拉取 identity 关联的仓库列表。
// page>0 时按平台能力做服务端分页（GitHub/GitLab），其它平台忽略分页参数返回全量。
func (u *GitIdentityUsecase) fetchRepositories(ctx context.Context, identity *db.GitIdentity, flush bool, page, size int, keyword string) (*domain.RepositoryPage, error) {
	if err := u.validateIdentityBaseURL(ctx, identity.Platform, identity.BaseURL); err != nil {
		return nil, err
	}
	client := u.gitClienter(identity)
	if client == nil {
		return &domain.RepositoryPage{}, nil
	}
	token, err := u.tokenProvider.GetToken(ctx, identity.ID)
	if err != nil {
		return nil, fmt.Errorf("get token: %w", err)
	}
	return client.Repositories(ctx, &domain.RepositoryOptions{
		Token:     token,
		InstallID: identity.InstallationID,
		IsOAuth:   identity.OauthRefreshToken != "",
		Flush:     flush,
		Page:      page,
		Size:      size,
		Keyword:   keyword,
	})
}

const (
	defaultRepoPageSize = 20
	maxRepoPageSize     = 100
)

// normalizeRepoPageSize 归一化分页大小：缺省 20，上限 100。
func normalizeRepoPageSize(size int) int {
	if size <= 0 {
		return defaultRepoPageSize
	}
	if size > maxRepoPageSize {
		return maxRepoPageSize
	}
	return size
}

// Get 获取单个 Git 身份认证（仅限当前用户）。
// page>0 时返回分页后的仓库列表与 RepoPageInfo；page==0 时返回全部仓库（RepoPageInfo 为 nil）。
func (u *GitIdentityUsecase) Get(ctx context.Context, uid uuid.UUID, id uuid.UUID, flush bool, page, size int, keyword string) (*domain.GitIdentity, error) {
	identity, err := u.repo.GetByUserID(ctx, uid, id)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		u.logger.ErrorContext(ctx, "failed to get git identity", "error", err, "user_id", uid, "id", id)
		return nil, err
	}
	gi := cvt.From(identity, &domain.GitIdentity{})

	if page > 0 {
		size = normalizeRepoPageSize(size)
	}
	repoPage, err := u.fetchRepositories(ctx, identity, flush, page, size, keyword)
	if err != nil {
		u.logger.WarnContext(ctx, "failed to get authorized repositories", "error", err, "platform", identity.Platform, "identity_id", identity.ID)
		return gi, nil
	}
	gi.AuthorizedRepositories = repoPage.Repositories
	gi.RepoPageInfo = repoPage.PageInfo

	return gi, nil
}

// Add 添加 Git 身份认证
func (u *GitIdentityUsecase) Add(ctx context.Context, uid uuid.UUID, req *domain.AddGitIdentityReq) (*domain.GitIdentity, error) {
	if err := u.validateIdentityBaseURL(ctx, req.Platform, req.BaseURL); err != nil {
		return nil, err
	}
	identity, err := u.repo.Create(ctx, uid, req)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to create git identity", "error", err, "user_id", uid)
		return nil, err
	}
	// Codeup 绑定时若未提供 organization_id，尝试通过 token 自动解析并回写
	if identity.Platform == consts.GitPlatformCodeup && identity.OrganizationID == "" && identity.AccessToken != "" {
		if orgID, rerr := u.resolveCodeupOrgID(ctx, identity); rerr == nil && orgID != "" {
			if uerr := u.repo.Update(ctx, uid, identity.ID, &domain.UpdateGitIdentityReq{
				ID:             identity.ID,
				OrganizationID: &orgID,
			}); uerr == nil {
				identity.OrganizationID = orgID
			} else {
				u.logger.WarnContext(ctx, "failed to persist resolved codeup org id",
					"identity_id", identity.ID, "error", uerr)
			}
		} else if rerr != nil {
			u.logger.WarnContext(ctx, "failed to resolve codeup org id",
				"identity_id", identity.ID, "error", rerr)
		}
	}
	u.prefetchRepositories(identity)
	return cvt.From(identity, &domain.GitIdentity{}), nil
}

// resolveCodeupOrgID 用 token 拉取云效组织信息，返回首个可用 orgID
func (u *GitIdentityUsecase) resolveCodeupOrgID(ctx context.Context, identity *db.GitIdentity) (string, error) {
	c := codeup.NewCodeup(identity.BaseURL, "", u.logger)
	return c.ResolveOrgID(ctx, identity.AccessToken)
}

// Update 更新 Git 身份认证
func (u *GitIdentityUsecase) Update(ctx context.Context, uid uuid.UUID, req *domain.UpdateGitIdentityReq) error {
	if req.BaseURL != nil {
		if err := u.validateBaseURL(ctx, *req.BaseURL); err != nil {
			return err
		}
	}
	if err := u.repo.Update(ctx, uid, req.ID, req); err != nil {
		u.logger.ErrorContext(ctx, "failed to update git identity", "error", err, "user_id", uid, "id", req.ID)
		return err
	}
	u.tokenProvider.ClearCache(req.ID)
	u.repoCache.Delete(uid.String() + ":" + req.ID.String())
	if identity, err := u.repo.Get(ctx, req.ID); err == nil {
		u.prefetchRepositories(identity)
	}
	return nil
}

// Delete 删除 Git 身份认证（若有关联项目则不允许删除）
func (u *GitIdentityUsecase) Delete(ctx context.Context, uid uuid.UUID, id uuid.UUID) error {
	identity, err := u.repo.Get(ctx, id)
	if err != nil {
		if db.IsNotFound(err) {
			return errcode.ErrNotFound
		}
		u.logger.ErrorContext(ctx, "failed to get git identity", "error", err, "user_id", uid, "id", id)
		return err
	}
	if identity.UserID != uid {
		return errcode.ErrNotFound
	}

	count, err := u.repo.CountProjectsByGitIdentityID(ctx, id)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to count projects by git identity", "error", err, "git_identity_id", id)
		return err
	}
	if count > 0 {
		return errcode.ErrGitIdentityInUseByProject
	}
	if err := u.repo.Delete(ctx, uid, id); err != nil {
		u.logger.ErrorContext(ctx, "failed to delete git identity", "error", err, "user_id", uid, "id", id)
		return err
	}
	u.tokenProvider.ClearCache(id)
	u.repoCache.Delete(uid.String() + ":" + id.String())
	return nil
}

// ListBranches 获取指定 git identity 关联仓库的分支列表
func (u *GitIdentityUsecase) ListBranches(ctx context.Context, uid uuid.UUID, identityID uuid.UUID, repoFullName string, page, perPage int) ([]*domain.Branch, error) {
	identity, err := u.repo.Get(ctx, identityID)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		u.logger.ErrorContext(ctx, "failed to get git identity", "error", err, "identity_id", identityID)
		return nil, err
	}
	if identity.UserID != uid {
		return nil, errcode.ErrNotFound
	}
	if err := u.validateIdentityBaseURL(ctx, identity.Platform, identity.BaseURL); err != nil {
		return nil, err
	}

	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 50
	}
	if perPage > 100 {
		perPage = 100
	}

	parts := strings.SplitN(repoFullName, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, errcode.ErrInvalidParameter.Wrap(fmt.Errorf("invalid repo full name: %s", repoFullName))
	}
	owner, repo := parts[0], parts[1]

	var client domain.GitClienter
	switch identity.Platform {
	case consts.GitPlatformGithub:
		client = github.NewGithub(u.logger, u.cfg)
	case consts.GitPlatformGitLab:
		client = gitlab.NewGitlabForBaseURL(identity.BaseURL, u.logger)
	case consts.GitPlatformGitea:
		client = gitea.NewGitea(u.logger, identity.BaseURL)
	case consts.GitPlatformGitee:
		client = gitee.NewGitee(identity.BaseURL, u.logger)
	case consts.GitPlatformCodeup:
		client = codeup.NewCodeup(identity.BaseURL, identity.OrganizationID, u.logger)
	case consts.GitPlatformCnb:
		client = cnb.NewCnb(identity.BaseURL, u.logger)
	case consts.GitPlatformAtomgit:
		client = atomgit.NewAtomgit(identity.BaseURL, u.logger)
	default:
		return nil, errcode.ErrInvalidPlatform
	}

	token, err := u.tokenProvider.GetToken(ctx, identity.ID)
	if err != nil {
		return nil, fmt.Errorf("get token: %w", err)
	}

	branches, err := client.Branches(ctx, &domain.BranchesOptions{
		Token: token, Owner: owner, Repo: repo,
		Page: page, PerPage: perPage,
		InstallID: identity.InstallationID, IsOAuth: identity.OauthRefreshToken != "",
	})
	if err != nil {
		return nil, fmt.Errorf("list branches: %w", err)
	}
	result := make([]*domain.Branch, 0, len(branches))
	for _, b := range branches {
		result = append(result, &domain.Branch{Name: b.Name})
	}
	return result, nil
}

func (u *GitIdentityUsecase) validateBaseURL(ctx context.Context, baseURL string) error {
	if err := u.guard.ValidateURL(ctx, baseURL); err != nil {
		return errcode.ErrForbiddenBaseURL.Wrap(err)
	}
	return nil
}

func (u *GitIdentityUsecase) validateIdentityBaseURL(ctx context.Context, platform consts.GitPlatform, baseURL string) error {
	if platform == consts.GitPlatformGithub {
		return nil
	}
	return u.validateBaseURL(ctx, baseURL)
}
