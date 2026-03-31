package repo

import (
	"context"
	"crypto/rand"
	"encoding/base64"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/gitbot"
	"github.com/chaitin/MonkeyCode/backend/db/gitbottask"
	"github.com/chaitin/MonkeyCode/backend/db/gitbotuser"
	"github.com/chaitin/MonkeyCode/backend/db/projectgitbot"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

// GitBotRepo GitBot 仓储
type GitBotRepo struct {
	db *db.Client
}

// NewGitBotRepo 创建 GitBot 仓储
func NewGitBotRepo(i *do.Injector) (domain.GitBotRepo, error) {
	return &GitBotRepo{
		db: do.MustInvoke[*db.Client](i),
	}, nil
}

// GetByID 通过 ID 获取 GitBot
func (r *GitBotRepo) GetByID(ctx context.Context, id uuid.UUID) (*db.GitBot, error) {
	return r.db.GitBot.Query().
		WithHost().
		WithUsers().
		WithProjects(func(pq *db.ProjectQuery) {
			pq.WithGitIdentity()
		}).
		Where(gitbot.ID(id)).
		First(ctx)
}

// GetInstallationID 通过 bot → project_git_bots → project → git_identity 链路获取 installation_id
func (r *GitBotRepo) GetInstallationID(ctx context.Context, botID uuid.UUID) (int64, error) {
	pgb, err := r.db.ProjectGitBot.Query().
		Where(projectgitbot.GitBotID(botID)).
		WithProject(func(pq *db.ProjectQuery) {
			pq.WithGitIdentity()
		}).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return 0, nil
		}
		return 0, err
	}
	p := pgb.Edges.Project
	if p == nil || p.Edges.GitIdentity == nil {
		return 0, nil
	}
	return p.Edges.GitIdentity.InstallationID, nil
}

// GetGitIdentityID 通过 bot → project_git_bots → project 链路获取 git_identity_id
func (r *GitBotRepo) GetGitIdentityID(ctx context.Context, botID uuid.UUID) (uuid.UUID, error) {
	pgb, err := r.db.ProjectGitBot.Query().
		Where(projectgitbot.GitBotID(botID)).
		WithProject().
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return uuid.Nil, nil
		}
		return uuid.Nil, err
	}
	p := pgb.Edges.Project
	if p == nil {
		return uuid.Nil, nil
	}
	return p.GitIdentityID, nil
}

// List 获取用户的 GitBot 列表
func (r *GitBotRepo) List(ctx context.Context, uid uuid.UUID) ([]*db.GitBot, error) {
	return r.db.GitBot.Query().
		WithHost().
		WithUsers().
		Where(gitbot.UserID(uid)).
		All(ctx)
}

// Create 创建 GitBot
func (r *GitBotRepo) Create(ctx context.Context, uid uuid.UUID, req domain.CreateGitBotReq) (*db.GitBot, error) {
	secret, err := generateSecretToken()
	if err != nil {
		return nil, err
	}
	return r.db.GitBot.Create().
		SetUserID(uid).
		SetHostID(req.HostID).
		SetName(req.Name).
		SetToken(req.Token).
		SetSecretToken(secret).
		SetPlatform(req.Platform).
		Save(ctx)
}

// Update 更新 GitBot
func (r *GitBotRepo) Update(ctx context.Context, uid uuid.UUID, req domain.UpdateGitBotReq) (*db.GitBot, error) {
	old, err := r.db.GitBot.Query().
		Where(gitbot.UserID(uid), gitbot.ID(req.ID)).
		First(ctx)
	if err != nil {
		return nil, err
	}

	upt := r.db.GitBot.UpdateOne(old)
	if req.Name != nil {
		upt.SetName(*req.Name)
	}
	if req.Token != nil {
		upt.SetToken(*req.Token)
	}
	if req.Platform != nil {
		upt.SetPlatform(*req.Platform)
	}
	if req.HostID != nil {
		upt.SetHostID(*req.HostID)
	}

	return upt.Save(ctx)
}

// Delete 删除 GitBot
func (r *GitBotRepo) Delete(ctx context.Context, uid uuid.UUID, id uuid.UUID) error {
	_, err := r.db.GitBot.Delete().
		Where(gitbot.UserID(uid), gitbot.ID(id)).
		Exec(ctx)
	return err
}

// ListTask 获取 GitBot 任务列表
func (r *GitBotRepo) ListTask(ctx context.Context, uid uuid.UUID, req domain.ListGitBotTaskReq) ([]*db.GitBotTask, *db.PageInfo, error) {
	q := r.db.GitBotTask.Query().
		WithGitBot().
		WithTask().
		Where(gitbottask.HasGitBotWith(gitbot.UserID(uid)))

	if req.ID != uuid.Nil {
		q = q.Where(gitbottask.GitBotID(req.ID))
	}

	total, err := q.Count(ctx)
	if err != nil {
		return nil, nil, err
	}

	var all []*db.GitBotTask
	if req.Page > 0 && req.Size > 0 {
		all, err = q.Offset((req.Page - 1) * req.Size).Limit(req.Size).All(ctx)
		if err != nil {
			return nil, nil, err
		}
	} else {
		all, err = q.All(ctx)
		if err != nil {
			return nil, nil, err
		}
	}

	pageInfo := &db.PageInfo{
		NextToken:   "",
		HasNextPage: int64(req.Page*req.Size) < int64(total),
		TotalCount:  int64(total),
	}
	return all, pageInfo, nil
}

// ShareBot 共享 GitBot
func (r *GitBotRepo) ShareBot(ctx context.Context, uid uuid.UUID, req domain.ShareGitBotReq) error {
	old, err := r.db.GitBot.Query().
		Where(gitbot.UserID(uid), gitbot.ID(req.ID)).
		First(ctx)
	if err != nil {
		return err
	}

	// 删除旧的共享关系
	if _, err := r.db.GitBotUser.Delete().
		Where(gitbotuser.GitBotID(old.ID)).
		Exec(ctx); err != nil {
		return err
	}

	// 创建新的共享关系
	creates := make([]*db.GitBotUserCreate, 0, len(req.UserIDs))
	for _, u := range req.UserIDs {
		creates = append(creates, r.db.GitBotUser.Create().
			SetGitBotID(old.ID).
			SetUserID(u))
	}

	if len(creates) == 0 {
		return nil
	}

	return r.db.GitBotUser.CreateBulk(creates...).Exec(ctx)
}

// generateSecretToken 生成随机 secret token
func generateSecretToken() (string, error) {
	const size = 32
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
