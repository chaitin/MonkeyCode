package usecase

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// GithubAccessTokenUsecase GitHub token 管理（仅 PAT 模式）
type GithubAccessTokenUsecase struct {
	repo   domain.GitIdentityRepo
	logger *slog.Logger
}

// NewGithubAccessTokenUsecase 创建 GithubAccessTokenUsecase
func NewGithubAccessTokenUsecase(i *do.Injector) (*GithubAccessTokenUsecase, error) {
	return &GithubAccessTokenUsecase{
		repo:   do.MustInvoke[domain.GitIdentityRepo](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "GithubAccessTokenUsecase"),
	}, nil
}

// GetValidAccessToken 获取有效的 access token（PAT 模式直接返回存储的 token）
func (u *GithubAccessTokenUsecase) GetValidAccessToken(ctx context.Context, identityID uuid.UUID) (string, error) {
	identity, err := u.repo.Get(ctx, identityID)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get git identity", "error", err, "identity_id", identityID)
		return "", fmt.Errorf("get git identity: %w", err)
	}
	if identity.AccessToken == "" {
		return "", fmt.Errorf("git identity %s has no access token", identityID)
	}
	return identity.AccessToken, nil
}
