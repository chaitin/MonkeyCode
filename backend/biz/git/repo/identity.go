package repo

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/gitidentity"
	"github.com/chaitin/MonkeyCode/backend/db/project"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

// GitIdentityRepo Git 身份认证仓储
type GitIdentityRepo struct {
	db     *db.Client
	logger *slog.Logger
}

// NewGitIdentityRepo 创建 Git 身份认证仓储
func NewGitIdentityRepo(i *do.Injector) (domain.GitIdentityRepo, error) {
	return &GitIdentityRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.GitIdentityRepo"),
	}, nil
}

// Get 获取 git identity
func (r *GitIdentityRepo) Get(ctx context.Context, id uuid.UUID) (*db.GitIdentity, error) {
	return r.db.GitIdentity.Query().Where(gitidentity.ID(id)).First(ctx)
}

// GetByUserID 获取用户的指定 Git 身份认证（同时验证 uid 和 id）
func (r *GitIdentityRepo) GetByUserID(ctx context.Context, uid uuid.UUID, id uuid.UUID) (*db.GitIdentity, error) {
	return r.db.GitIdentity.Query().Where(gitidentity.ID(id), gitidentity.UserID(uid)).First(ctx)
}

// List 获取用户的 Git 身份认证列表
func (r *GitIdentityRepo) List(ctx context.Context, uid uuid.UUID) ([]*db.GitIdentity, error) {
	return r.db.GitIdentity.Query().Where(gitidentity.UserID(uid)).All(ctx)
}

// Create 创建 Git 身份认证
func (r *GitIdentityRepo) Create(ctx context.Context, uid uuid.UUID, req *domain.AddGitIdentityReq) (*db.GitIdentity, error) {
	return r.db.GitIdentity.Create().
		SetUserID(uid).
		SetPlatform(req.Platform).
		SetBaseURL(req.BaseURL).
		SetAccessToken(req.AccessToken).
		SetUsername(req.Username).
		SetEmail(req.Email).
		SetRemark(req.Remark).
		Save(ctx)
}

// Update 更新 Git 身份认证
func (r *GitIdentityRepo) Update(ctx context.Context, uid uuid.UUID, id uuid.UUID, req *domain.UpdateGitIdentityReq) error {
	upt := r.db.GitIdentity.UpdateOneID(id).Where(gitidentity.UserID(uid))
	if req.Platform != nil {
		upt.SetPlatform(*req.Platform)
	}
	if req.BaseURL != nil {
		upt.SetBaseURL(*req.BaseURL)
	}
	if req.AccessToken != nil {
		upt.SetAccessToken(*req.AccessToken)
	}
	if req.Username != nil {
		upt.SetUsername(*req.Username)
	}
	if req.Email != nil {
		upt.SetEmail(*req.Email)
	}
	if req.Remark != nil {
		upt.SetRemark(*req.Remark)
	}
	if req.OAuthRefreshToken != nil {
		upt.SetOauthRefreshToken(*req.OAuthRefreshToken)
	}
	if req.OAuthExpiresAt != nil {
		upt.SetOauthExpiresAt(*req.OAuthExpiresAt)
	}
	return upt.Exec(ctx)
}

// CountProjectsByGitIdentityID 统计使用该 Git 身份的项目数量
func (r *GitIdentityRepo) CountProjectsByGitIdentityID(ctx context.Context, id uuid.UUID) (int, error) {
	return r.db.Project.Query().Where(project.GitIdentityIDEQ(id)).Count(ctx)
}

// Delete 删除 Git 身份认证
func (r *GitIdentityRepo) Delete(ctx context.Context, uid uuid.UUID, id uuid.UUID) error {
	err := r.db.GitIdentity.
		DeleteOneID(id).
		Where(gitidentity.UserID(uid)).
		Exec(ctx)
	if err != nil && db.IsNotFound(err) {
		return nil
	}
	return err
}
