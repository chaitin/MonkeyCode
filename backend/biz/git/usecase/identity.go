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
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitea"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitee"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/github"
	"github.com/chaitin/MonkeyCode/backend/pkg/git/gitlab"
)

// GitIdentityUsecase Git 身份认证用例
type GitIdentityUsecase struct {
	cfg           *config.Config
	repo          domain.GitIdentityRepo
	tokenProvider *TokenProvider
	logger        *slog.Logger
	repoCache     *cache.Cache
}

// NewGitIdentityUsecase 创建 Git 身份认证用例
func NewGitIdentityUsecase(i *do.Injector) (domain.GitIdentityUsecase, error) {
	return &GitIdentityUsecase{
		cfg:           do.MustInvoke[*config.Config](i),
		repo:          do.MustInvoke[domain.GitIdentityRepo](i),
		tokenProvider: do.MustInvoke[*TokenProvider](i),
		logger:        do.MustInvoke[*slog.Logger](i).With("module", "GitIdentityUsecase"),
		repoCache:     cache.New(7*24*time.Hour, 10*time.Minute),
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
		if _, err := u.fetchRepositories(ctx, identity, false); err != nil {
			u.logger.WarnContext(ctx, "prefetch: failed to fetch repositories", "error", err, "identity_id", identity.ID)
		}
	}()
}

// fetchRepositories 拉取 identity 关联的仓库列表
func (u *GitIdentityUsecase) fetchRepositories(ctx context.Context, identity *db.GitIdentity, flush bool) ([]domain.AuthRepository, error) {
	client := u.gitClienter(identity)
	if client == nil {
		return nil, nil
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
	})
}

// Get 获取单个 Git 身份认证（仅限当前用户）
func (u *GitIdentityUsecase) Get(ctx context.Context, uid uuid.UUID, id uuid.UUID, flush bool) (*domain.GitIdentity, error) {
	identity, err := u.repo.GetByUserID(ctx, uid, id)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		u.logger.ErrorContext(ctx, "failed to get git identity", "error", err, "user_id", uid, "id", id)
		return nil, err
	}
	gi := cvt.From(identity, &domain.GitIdentity{})

	repos, err := u.fetchRepositories(ctx, identity, flush)
	if err != nil {
		u.logger.WarnContext(ctx, "failed to get authorized repositories", "error", err, "platform", identity.Platform, "identity_id", identity.ID)
		return gi, nil
	}
	gi.AuthorizedRepositories = repos

	return gi, nil
}

// Add 添加 Git 身份认证
func (u *GitIdentityUsecase) Add(ctx context.Context, uid uuid.UUID, req *domain.AddGitIdentityReq) (*domain.GitIdentity, error) {
	identity, err := u.repo.Create(ctx, uid, req)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to create git identity", "error", err, "user_id", uid)
		return nil, err
	}
	u.prefetchRepositories(identity)
	return cvt.From(identity, &domain.GitIdentity{}), nil
}

// Update 更新 Git 身份认证
func (u *GitIdentityUsecase) Update(ctx context.Context, uid uuid.UUID, req *domain.UpdateGitIdentityReq) error {
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
