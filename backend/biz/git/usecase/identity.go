package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/samber/do"

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
	repo   domain.GitIdentityRepo
	gh     *github.Github
	logger *slog.Logger
}

// NewGitIdentityUsecase 创建 Git 身份认证用例
func NewGitIdentityUsecase(i *do.Injector) (domain.GitIdentityUsecase, error) {
	logger := do.MustInvoke[*slog.Logger](i)
	return &GitIdentityUsecase{
		repo:   do.MustInvoke[domain.GitIdentityRepo](i),
		gh:     github.NewGithub(logger),
		logger: logger.With("module", "GitIdentityUsecase"),
	}, nil
}

// List 获取用户的 Git 身份认证列表
func (u *GitIdentityUsecase) List(ctx context.Context, uid uuid.UUID) ([]*domain.GitIdentity, error) {
	identities, err := u.repo.List(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to list git identities", "error", err, "user_id", uid)
		return nil, err
	}
	return cvt.Iter(identities, func(_ int, g *db.GitIdentity) *domain.GitIdentity {
		return cvt.From(g, &domain.GitIdentity{})
	}), nil
}

// Get 获取单个 Git 身份认证（仅限当前用户）
func (u *GitIdentityUsecase) Get(ctx context.Context, uid uuid.UUID, id uuid.UUID) (*domain.GitIdentity, error) {
	identity, err := u.repo.Get(ctx, id)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		u.logger.ErrorContext(ctx, "failed to get git identity", "error", err, "user_id", uid, "id", id)
		return nil, err
	}
	if identity.UserID != uid {
		return nil, errcode.ErrNotFound
	}
	gi := cvt.From(identity, &domain.GitIdentity{})

	// PAT 模式：获取授权仓库列表
	if identity.AccessToken == "" {
		return gi, nil
	}
	var client domain.GitPlatformClient[domain.AuthRepository]
	switch identity.Platform {
	case consts.GitPlatformGithub:
		client = u.gh
	case consts.GitPlatformGitLab:
		client = gitlab.NewGitlab(identity.BaseURL, identity.AccessToken, u.logger)
	case consts.GitPlatformGitea:
		client = gitea.NewGitea(u.logger, identity.BaseURL)
	default:
		// 该平台不支持获取授权仓库列表
		return gi, nil
	}
	repos, err := client.GetAuthorizedRepositories(ctx, identity.AccessToken)
	if err != nil {
		u.logger.WarnContext(ctx, "failed to get authorized repositories", "error", err, "platform", identity.Platform, "identity_id", id)
	} else {
		gi.AuthorizedRepositories = make([]domain.AuthRepository, 0, len(repos))
		for _, r := range repos {
			gi.AuthorizedRepositories = append(gi.AuthorizedRepositories, domain.AuthRepository{
				FullName:    r.FullName,
				URL:         r.URL,
				Description: r.Description,
			})
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

	switch identity.Platform {
	case consts.GitPlatformGithub:
		return u.listGithubBranches(ctx, identity, owner, repo, page, perPage)
	case consts.GitPlatformGitLab:
		return u.listGitlabBranches(ctx, identity, repoFullName, page, perPage)
	case consts.GitPlatformGitea:
		return u.listGiteaBranches(ctx, identity, owner, repo, page, perPage)
	case consts.GitPlatformGitee:
		return u.listGiteeBranches(ctx, identity, owner, repo, page, perPage)
	default:
		return nil, errcode.ErrInvalidPlatform
	}
}

func (u *GitIdentityUsecase) listGithubBranches(ctx context.Context, identity *db.GitIdentity, owner, repo string, page, perPage int) ([]*domain.Branch, error) {
	if u.gh == nil {
		return nil, fmt.Errorf("github client not configured")
	}
	branches, err := u.gh.ListBranches(ctx, identity.AccessToken, owner, repo, page, perPage)
	if err != nil {
		return nil, fmt.Errorf("list github branches: %w", err)
	}
	result := make([]*domain.Branch, 0, len(branches))
	for _, b := range branches {
		result = append(result, &domain.Branch{Name: b.Name})
	}
	return result, nil
}

func (u *GitIdentityUsecase) listGitlabBranches(ctx context.Context, identity *db.GitIdentity, projectPath string, page, perPage int) ([]*domain.Branch, error) {
	glClient := gitlab.NewGitlabForBaseURL(identity.BaseURL, u.logger)
	if glClient == nil {
		return nil, fmt.Errorf("failed to create gitlab client for base_url: %s", identity.BaseURL)
	}
	branches, err := glClient.ListBranches(ctx, identity.AccessToken, projectPath, false, page, perPage)
	if err != nil {
		return nil, fmt.Errorf("list gitlab branches: %w", err)
	}
	result := make([]*domain.Branch, 0, len(branches))
	for _, b := range branches {
		result = append(result, &domain.Branch{Name: b.Name})
	}
	return result, nil
}

func (u *GitIdentityUsecase) listGiteaBranches(ctx context.Context, identity *db.GitIdentity, owner, repo string, page, perPage int) ([]*domain.Branch, error) {
	branches, err := gitea.ListBranches(ctx, identity.BaseURL, identity.AccessToken, owner, repo, page, perPage, false)
	if err != nil {
		return nil, fmt.Errorf("list gitea branches: %w", err)
	}
	result := make([]*domain.Branch, 0, len(branches))
	for _, b := range branches {
		result = append(result, &domain.Branch{Name: b.Name})
	}
	return result, nil
}

func (u *GitIdentityUsecase) listGiteeBranches(ctx context.Context, identity *db.GitIdentity, owner, repo string, page, perPage int) ([]*domain.Branch, error) {
	branches, err := gitee.ListBranches(ctx, identity.AccessToken, owner, repo, page, perPage, false)
	if err != nil {
		return nil, fmt.Errorf("list gitee branches: %w", err)
	}
	result := make([]*domain.Branch, 0, len(branches))
	for _, b := range branches {
		result = append(result, &domain.Branch{Name: b.Name})
	}
	return result, nil
}
