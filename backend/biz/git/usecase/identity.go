package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
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
)

// GitIdentityUsecase Git 身份认证用例
type GitIdentityUsecase struct {
	cfg           *config.Config
	repo          domain.GitIdentityRepo
	tokenProvider *TokenProvider
	logger        *slog.Logger
}

// NewGitIdentityUsecase 创建 Git 身份认证用例
func NewGitIdentityUsecase(i *do.Injector) (domain.GitIdentityUsecase, error) {
	return &GitIdentityUsecase{
		cfg:           do.MustInvoke[*config.Config](i),
		repo:          do.MustInvoke[domain.GitIdentityRepo](i),
		tokenProvider: do.MustInvoke[*TokenProvider](i),
		logger:        do.MustInvoke[*slog.Logger](i).With("module", "GitIdentityUsecase"),
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
		tmp := cvt.From(identity, &domain.GitIdentity{})
		if client := u.gitClienter(identity); client != nil {
			token, err := u.tokenProvider.GetToken(ctx, identity.ID)
			if err != nil {
				u.logger.WarnContext(ctx, "failed to get token", "error", err, "platform", identity.Platform, "identity_id", identity.ID)
				return tmp
			}
			repos, err := client.Repositories(ctx, &domain.RepositoryOptions{
				Token:     token,
				InstallID: identity.InstallationID,
			})
			if err != nil {
				u.logger.WarnContext(ctx, "failed to get authorized repositories", "error", err, "platform", identity.Platform, "identity_id", identity.ID)
			} else {
				tmp.AuthorizedRepositories = repos
			}
		}
		return tmp
	}), nil
}

func (u *GitIdentityUsecase) gitClienter(identity *db.GitIdentity) domain.GitClienter {
	switch identity.Platform {
	case consts.GitPlatformGithub:
		return github.NewGithub(u.logger, u.cfg)
	case consts.GitPlatformGitLab:
		return gitlab.NewGitlab(identity.BaseURL, identity.AccessToken, u.logger)
	case consts.GitPlatformGitea:
		return gitea.NewGitea(u.logger, identity.BaseURL)
	case consts.GitPlatformGitee:
		return gitee.NewGitee(identity.BaseURL, u.logger)
	default:
		return nil
	}
}

// Get 获取单个 Git 身份认证（仅限当前用户）
func (u *GitIdentityUsecase) Get(ctx context.Context, uid uuid.UUID, id uuid.UUID) (*domain.GitIdentity, error) {
	identity, err := u.repo.GetByUserID(ctx, uid, id)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		u.logger.ErrorContext(ctx, "failed to get git identity", "error", err, "user_id", uid, "id", id)
		return nil, err
	}
	gi := cvt.From(identity, &domain.GitIdentity{})

	if client := u.gitClienter(identity); client != nil {
		token, err := u.tokenProvider.GetToken(ctx, identity.ID)
		if err != nil {
			u.logger.WarnContext(ctx, "failed to get token", "error", err, "platform", identity.Platform, "identity_id", id)
			return gi, nil
		}
		repos, err := client.Repositories(ctx, &domain.RepositoryOptions{
			Token:     token,
			InstallID: identity.InstallationID,
		})
		if err != nil {
			u.logger.WarnContext(ctx, "failed to get authorized repositories", "error", err, "platform", identity.Platform, "identity_id", id)
		} else {
			gi.AuthorizedRepositories = repos
		}
	}

	return gi, nil
}

// Add 添加 Git 身份认证
func (u *GitIdentityUsecase) Add(ctx context.Context, uid uuid.UUID, req *domain.AddGitIdentityReq) (*domain.GitIdentity, error) {
	identity, err := u.repo.Create(ctx, uid, req)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to create git identity", "error", err, "user_id", uid)
		return nil, err
	}
	return cvt.From(identity, &domain.GitIdentity{}), nil
}

// Update 更新 Git 身份认证
func (u *GitIdentityUsecase) Update(ctx context.Context, uid uuid.UUID, req *domain.UpdateGitIdentityReq) error {
	if err := u.repo.Update(ctx, uid, req.ID, req); err != nil {
		u.logger.ErrorContext(ctx, "failed to update git identity", "error", err, "user_id", uid, "id", req.ID)
		return err
	}
	u.tokenProvider.ClearCache(req.ID)
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

	branches, err := client.Branches(ctx, &domain.BranchesOptions{
		Token: identity.AccessToken, Owner: owner, Repo: repo,
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
