package usecase

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// GitBotUsecase GitBot 业务逻辑
type GitBotUsecase struct {
	cfg           *config.Config
	repo          domain.GitBotRepo
	logger        *slog.Logger
	tokenProvider *TokenProvider
}

// NewGitBotUsecase 创建 GitBot 业务逻辑
func NewGitBotUsecase(i *do.Injector) (domain.GitBotUsecase, error) {
	return &GitBotUsecase{
		cfg:           do.MustInvoke[*config.Config](i),
		repo:          do.MustInvoke[domain.GitBotRepo](i),
		logger:        do.MustInvoke[*slog.Logger](i).With("module", "usecase.GitBotUsecase"),
		tokenProvider: do.MustInvoke[*TokenProvider](i),
	}, nil
}

// GetByID 通过 ID 获取 GitBot
func (u *GitBotUsecase) GetByID(ctx context.Context, id uuid.UUID) (*domain.GitBot, error) {
	bot, err := u.repo.GetByID(ctx, id)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, err
	}
	dbot := cvt.From(bot, &domain.GitBot{
		WebhookURL: u.webhookURL(bot),
	})

	if len(bot.Edges.Projects) == 0 {
		return dbot, nil
	}
	p := bot.Edges.Projects[0]
	if p.Edges.GitIdentity == nil {
		return dbot, nil
	}

	token, err := u.tokenProvider.GetToken(ctx, p.Edges.GitIdentity.ID)
	if err != nil {
		return nil, err
	}
	dbot.Token = token
	return dbot, nil
}

// GetInstallationID 获取 installation_id
func (u *GitBotUsecase) GetInstallationID(ctx context.Context, botID uuid.UUID) (int64, error) {
	return u.repo.GetInstallationID(ctx, botID)
}

// GetAccessToken 获取 access_token
func (u *GitBotUsecase) GetAccessToken(ctx context.Context, botID uuid.UUID) (string, error) {
	identityID, err := u.repo.GetGitIdentityID(ctx, botID)
	if err != nil {
		return "", fmt.Errorf("get git identity id: %w", err)
	}
	if identityID == uuid.Nil {
		bot, err := u.repo.GetByID(ctx, botID)
		if err != nil {
			return "", err
		}
		if bot.Token == "" {
			return "", fmt.Errorf("no token found")
		}
		return bot.Token, nil
	}
	return u.tokenProvider.GetToken(ctx, identityID)
}

// List 获取用户的 GitBot 列表
func (u *GitBotUsecase) List(ctx context.Context, uid uuid.UUID) (*domain.ListGitBotResp, error) {
	bots, err := u.repo.List(ctx, uid)
	if err != nil {
		return nil, err
	}
	return &domain.ListGitBotResp{
		Bots: cvt.Iter(bots, func(_ int, bot *db.GitBot) *domain.GitBot {
			return cvt.From(bot, &domain.GitBot{
				WebhookURL: u.webhookURL(bot),
			})
		}),
	}, nil
}

// Create 创建 GitBot
func (u *GitBotUsecase) Create(ctx context.Context, uid uuid.UUID, req domain.CreateGitBotReq) (*domain.GitBot, error) {
	bot, err := u.repo.Create(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(bot, &domain.GitBot{
		WebhookURL: u.webhookURL(bot),
	}), nil
}

// Update 更新 GitBot
func (u *GitBotUsecase) Update(ctx context.Context, uid uuid.UUID, req domain.UpdateGitBotReq) (*domain.GitBot, error) {
	bot, err := u.repo.Update(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(bot, &domain.GitBot{
		WebhookURL: u.webhookURL(bot),
	}), nil
}

// Delete 删除 GitBot
func (u *GitBotUsecase) Delete(ctx context.Context, uid, id uuid.UUID) error {
	return u.repo.Delete(ctx, uid, id)
}

// ListTask 获取 GitBot 任务列表
func (u *GitBotUsecase) ListTask(ctx context.Context, uid uuid.UUID, req domain.ListGitBotTaskReq) (*domain.ListGitBotTaskResp, error) {
	tasks, pageInfo, err := u.repo.ListTask(ctx, uid, req)
	if err != nil {
		return nil, err
	}
	return &domain.ListGitBotTaskResp{
		Tasks: cvt.Iter(tasks, func(_ int, t *db.GitBotTask) *domain.GitBotTask {
			return cvt.From(t, &domain.GitBotTask{})
		}),
		Page:  pageInfo.TotalCount,
		Size:  int64(req.Size),
		Total: pageInfo.TotalCount,
	}, nil
}

// ShareBot 共享 GitBot
func (u *GitBotUsecase) ShareBot(ctx context.Context, uid uuid.UUID, req domain.ShareGitBotReq) error {
	return u.repo.ShareBot(ctx, uid, req)
}

func (u *GitBotUsecase) webhookURL(bot *db.GitBot) string {
	return fmt.Sprintf("%s/api/v1/%s/webhook/%s", u.cfg.Server.BaseURL, bot.Platform, bot.ID.String())
}
