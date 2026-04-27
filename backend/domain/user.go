package domain

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type UserUsecase interface {
	Get(ctx context.Context, uid uuid.UUID) (*User, error)
	Update(ctx context.Context, uid uuid.UUID, avatarURL string, req UpdateUserReq) (*User, error)
	GetUserWithTeams(ctx context.Context, userID uuid.UUID) (*TeamUserInfo, error)
	PasswordLogin(ctx context.Context, req *TeamLoginReq) (*User, error)
	ChangePassword(ctx context.Context, userID uuid.UUID, req *ChangePasswordReq, isReset bool) error
	SendResetPasswordEmail(ctx context.Context, req *ResetUserPasswordEmailReq) error
	GetUserByEmail(ctx context.Context, emails []string) ([]*User, error)
	SendBindEmailVerification(ctx context.Context, userID uuid.UUID, req *SendBindEmailVerificationReq) error
	VerifyBindEmail(ctx context.Context, token string) error
}

type UserRepo interface {
	Get(ctx context.Context, uid uuid.UUID) (*db.User, error)
	Update(ctx context.Context, uid uuid.UUID, name, avatarURL string) error
	GetUserWithTeams(ctx context.Context, uid uuid.UUID) (*db.User, error)
	PasswordLogin(ctx context.Context, req *TeamLoginReq) (*db.User, error)
	ChangePassword(ctx context.Context, uid uuid.UUID, currentPassword, newPassword string, isReset bool) error
	GetUserByEmail(ctx context.Context, emails []string) ([]*db.User, error)
	SetEmail(ctx context.Context, userID uuid.UUID, email string) error
}

// UserActiveRepo 用户活跃记录仓储接口
type UserActiveRepo interface {
	RecordActiveIP(ctx context.Context, key string, ip string) error
	RecordActiveRecord(ctx context.Context, key consts.RedisKey, field string, score time.Time) error
	GetActiveRecord(ctx context.Context, key consts.RedisKey, userID string) (time.Time, error)
}

type User struct {
	ID          uuid.UUID         `json:"id"`
	Name        string            `json:"name"`
	AvatarURL   string            `json:"avatar_url"`
	Email       string            `json:"email"`
	Role        consts.UserRole   `json:"role"`
	Status      consts.UserStatus `json:"status"`
	IsBlocked   bool              `json:"is_blocked"`
	Token       string            `json:"token,omitempty"`
	Identities  []*UserIdentity   `json:"identities"`
	Team        *Team             `json:"team,omitempty"`
	HasPassword bool              `json:"has_password"`
}

func (u *User) From(src *db.User) *User {
	if src == nil {
		return u
	}

	u.ID = src.ID
	u.Name = src.Name
	u.AvatarURL = src.AvatarURL
	u.Email = src.Email
	u.Role = src.Role
	u.Status = src.Status
	u.IsBlocked = src.IsBlocked
	u.HasPassword = src.Password != ""
	u.Identities = cvt.Iter(src.Edges.Identities, func(_ int, i *db.UserIdentity) *UserIdentity {
		return cvt.From(i, &UserIdentity{})
	})
	if teams := src.Edges.Teams; len(teams) > 0 {
		u.Team = cvt.From(teams[0], &Team{})
	}
	return u
}

type UserIdentity struct {
	ID         uuid.UUID           `json:"id"`
	AvatarURL  string              `json:"avatar_url"`
	Username   string              `json:"username"`
	IdentityID string              `json:"identity_id"`
	Platform   consts.UserPlatform `json:"platform"`
	Email      string              `json:"email"`
}

func (i *UserIdentity) From(src *db.UserIdentity) *UserIdentity {
	if src == nil {
		return i
	}

	i.ID = src.ID
	i.AvatarURL = src.AvatarURL
	i.Username = src.Username
	i.Platform = src.Platform
	i.Email = src.Email
	i.IdentityID = src.IdentityID

	return i
}

// TeamUserInfo 用户团队信息
type TeamUserInfo struct {
	User  *User         `json:"user"`
	Teams []*TeamMember `json:"teams"`
}

// From 从数据库模型转换为领域模型
func (t *TeamUserInfo) From(src *db.User) *TeamUserInfo {
	if src == nil {
		return t
	}
	t.User = cvt.From(src, &User{})
	t.Teams = cvt.Iter(src.Edges.TeamMembers, func(_ int, team *db.TeamMember) *TeamMember {
		return cvt.From(team, &TeamMember{})
	})
	return t
}

// TeamUserLoginResp 团队用户登录响应
type TeamUserLoginResp struct {
	TeamUserInfo
}

// UpdateUserReq 更新用户信息请求
type UpdateUserReq struct {
	Name      string `json:"name,omitempty" form:"name"`
	AvatarURL string `json:"avatar_url,omitempty" form:"avatar_url"`
}

// UpdateUserResp 更新用户信息响应
type UpdateUserResp struct {
	User    *User  `json:"user"`
	Message string `json:"message"`
	Success bool   `json:"success"`
}

// GetAccountInfoReq 通过 token 查询账户信息请求
type GetAccountInfoReq struct {
	Token string `param:"token" validate:"required"`
}

// ResetUserPasswordReq 修改密码请求
type ResetUserPasswordReq struct {
	NewPassword string `json:"new_password" validate:"required"`
	Token       string `json:"token" validate:"required"`
}

func (r *ResetUserPasswordReq) Validate() error {
	if len(r.NewPassword) < 8 || len(r.NewPassword) > 32 {
		return errcode.ErrPasswordLength
	}
	return nil
}

// ResetUserPasswordEmailReq 发送重置密码邮件请求
type ResetUserPasswordEmailReq struct {
	Emails       []string `json:"emails" validate:"required"`
	CaptchaToken string   `json:"captcha_token"`
}

func (r *ResetUserPasswordEmailReq) Validate() error {
	if len(r.Emails) == 0 {
		return errcode.ErrEmailRequired
	}
	for _, email := range r.Emails {
		if strings.TrimSpace(email) == "" {
			return errcode.ErrEmailRequired
		}
	}
	return nil
}

// TeamMembersResp 团队成员列表响应
type TeamMembersResp []*User

// ActivateReq 激活请求
type ActivateReq struct {
	InviteCode string `json:"invite_code" validate:"required"`
	InviterID  string `json:"inviter_id,omitempty"`
}

// CursorReq 游标分页请求
type CursorReq struct {
	Cursor string `query:"cursor"`
	Limit  int    `query:"limit"`
}

// SendBindEmailVerificationReq 发送邮箱绑定验证邮件请求
type SendBindEmailVerificationReq struct {
	Email string `json:"email" validate:"required,email"` // 要绑定的邮箱地址
}

// VerifyBindEmailReq 验证邮箱请求
type VerifyBindEmailReq struct {
	Token string `query:"token" validate:"required"` // 验证 token
}
