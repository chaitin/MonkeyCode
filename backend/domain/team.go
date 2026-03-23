package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

// TeamGroupUserUsecase 团队分组成员业务逻辑接口
type TeamGroupUserUsecase interface {
	List(ctx context.Context, teamUser *TeamUser) (*ListTeamGroupsResp, error)
	Add(ctx context.Context, teamUser *TeamUser, req *AddTeamGroupReq) (*TeamGroup, error)
	AddUser(ctx context.Context, teamUser *TeamUser, req *AddTeamUserReq) (*AddTeamUserResp, error)
	AddAdmin(ctx context.Context, teamUser *TeamUser, req *AddTeamAdminReq) (*AddTeamAdminResp, error)
	Update(ctx context.Context, req *UpdateTeamGroupReq) (*TeamGroup, error)
	Delete(ctx context.Context, teamUser *TeamUser, req *DeleteTeamGroupReq) error
	ListGroups(ctx context.Context, req *ListTeamGroupUsersReq) (*ListTeamGroupUsersResp, error)
	ModifyGroups(ctx context.Context, req *AddTeamGroupUsersReq) (*AddTeamGroupUsersResp, error)
	DeleteGroups(ctx context.Context, req *DeleteTeamGroupUserReq) error
	Login(ctx context.Context, req *TeamLoginReq) (*User, error)
	MemberList(ctx context.Context, teamUser *TeamUser, req *MemberListReq) (*MemberListResp, error)
	ChangePassword(ctx context.Context, userID uuid.UUID, req *ChangePasswordReq) error
	UpdateUser(ctx context.Context, req *UpdateTeamUserReq) (*UpdateTeamUserResp, error)
}

// TeamGroupUserRepo 团队分组成员数据访问接口
type TeamGroupUserRepo interface {
	List(ctx context.Context, teamID uuid.UUID) ([]*db.TeamGroup, error)
	Get(ctx context.Context, groupID uuid.UUID) (*db.TeamGroup, error)
	Create(ctx context.Context, teamID uuid.UUID, req *AddTeamGroupReq) (*db.TeamGroup, error)
	CreateUsers(ctx context.Context, teamID uuid.UUID, req *AddTeamUserReq) ([]*db.User, error)
	CreateAdmin(ctx context.Context, teamID uuid.UUID, req *AddTeamAdminReq) (*db.User, error)
	Update(ctx context.Context, req *UpdateTeamGroupReq) (*db.TeamGroup, error)
	Delete(ctx context.Context, teamID, groupID uuid.UUID) error
	ListGroupUsers(ctx context.Context, groupID uuid.UUID) ([]*db.TeamGroupMember, error)
	ModifyGroupUsers(ctx context.Context, groupID uuid.UUID, userIDs []uuid.UUID) ([]*db.TeamGroupMember, error)
	DeleteGroupUser(ctx context.Context, groupID, userID uuid.UUID) error
	Login(ctx context.Context, req *TeamLoginReq) (*db.User, error)
	MemberList(ctx context.Context, teamID uuid.UUID, role consts.TeamMemberRole) ([]*db.TeamMember, error)
	ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword, newPassword string) error
	GetTeam(ctx context.Context, teamID uuid.UUID) (*db.Team, error)
	UpdateUser(ctx context.Context, userID uuid.UUID, req *UpdateTeamUserReq) (*db.User, error)
	GetMembersByIDs(ctx context.Context, teamID uuid.UUID, userIDs []uuid.UUID) ([]*db.TeamMember, error)
	GetMember(ctx context.Context, teamID, userID uuid.UUID) (*db.TeamMember, error)
	InitTeam(ctx context.Context, email, name, password string) error
}

type Team struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// From 从数据库模型转换为领域模型
func (t *Team) From(src *db.Team) *Team {
	if src == nil {
		return t
	}
	t.ID = src.ID
	t.Name = src.Name
	return t
}

// TeamMember 团队成员
type TeamMember struct {
	TeamID   uuid.UUID             `json:"team_id"`
	UserID   uuid.UUID             `json:"user_id"`
	TeamName string                `json:"team_name"`
	TeamRole consts.TeamMemberRole `json:"team_role"`
}

// From 从数据库模型转换为领域模型
func (t *TeamMember) From(src *db.TeamMember) *TeamMember {
	if src == nil {
		return t
	}
	t.TeamID = src.TeamID
	t.UserID = src.UserID
	if src.Edges.Team != nil {
		t.TeamName = src.Edges.Team.Name
	}
	t.TeamRole = src.Role
	return t
}

// TeamUser 用户团队信息
type TeamUser struct {
	User *User `json:"user"`
	Team *Team `json:"team"`
}

// From 从数据库模型转换为领域模型
func (t *TeamUser) From(src *db.User) *TeamUser {
	if src == nil {
		return t
	}
	t.User = cvt.From(src, &User{})
	if teams := src.Edges.Teams; len(teams) > 0 {
		t.Team = cvt.From(teams[0], &Team{})
	}

	return t
}

// GetTeamID 获取团队ID
func (t *TeamUser) GetTeamID() uuid.UUID {
	if t.Team != nil {
		return t.Team.ID
	}
	return uuid.Nil
}

// TeamGroup 团队分组信息
type TeamGroup struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	CreatedAt int64     `json:"created_at"`
	UpdatedAt int64     `json:"updated_at"`
	Users     []*User   `json:"users,omitempty"`
}

// From 从数据库模型转换为领域模型
func (t *TeamGroup) From(src *db.TeamGroup) *TeamGroup {
	if src == nil {
		return t
	}

	t.ID = src.ID
	t.Name = src.Name
	t.CreatedAt = src.CreatedAt.Unix()
	t.UpdatedAt = src.UpdatedAt.Unix()
	t.Users = cvt.Iter(src.Edges.Members, func(_ int, member *db.User) *User {
		return cvt.From(member, &User{})
	})
	return t
}

// ListTeamGroupsReq 获取团队分组列表请求
type ListTeamGroupsReq struct{}

// ListTeamGroupsResp 获取团队分组列表响应
type ListTeamGroupsResp struct {
	Groups []*TeamGroup `json:"groups"`
}

// AddTeamGroupReq 创建团队分组请求
type AddTeamGroupReq struct {
	Name string `json:"name" validate:"required"`
}

// UpdateTeamGroupReq 更新团队分组请求
type UpdateTeamGroupReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	Name    string    `json:"name" validate:"required"`
}

// DeleteTeamGroupReq 删除团队分组请求
type DeleteTeamGroupReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
}

// ListTeamGroupUsersReq 获取团队组成员列表请求
type ListTeamGroupUsersReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
}

// ListTeamGroupUsersResp 获取团队组成员列表响应
type ListTeamGroupUsersResp struct {
	Users []*User `json:"users"`
}

// AddTeamGroupUsersReq 添加团队组成员请求
type AddTeamGroupUsersReq struct {
	GroupID uuid.UUID   `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	UserIDs []uuid.UUID `json:"user_ids" validate:"required"`
}

// AddTeamGroupUsersResp 添加团队组成员响应
type AddTeamGroupUsersResp struct {
	Users []*User `json:"users"`
}

// DeleteTeamGroupUserReq 删除团队组成员请求
type DeleteTeamGroupUserReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	UserID  uuid.UUID `param:"user_id" validate:"required" json:"-" swaggerignore:"true"`
}

// JoinGroupReq 用户加入团队分组请求
type JoinGroupReq struct {
	InviteCode string `query:"invite_code" validate:"required"` // 邀请码
}

// JoinGroupResp 用户加入团队分组响应
type JoinGroupResp struct {
	Message string `json:"message"`
	Success bool   `json:"success"`
}

// TeamLoginReq 团队用户登录请求
type TeamLoginReq struct {
	Email        string `json:"email" validate:"required"`    // 用户邮箱
	Password     string `json:"password" validate:"required"` // 用户密码（MD5加密后的值）
	CaptchaToken string `json:"captcha_token"`                // 验证码Token
}

// TeamLoginResp 团队用户登录响应
type TeamLoginResp struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	TeamUser
}

// TeamUserStatusResp 团队用户状态响应
type TeamUserStatusResp struct {
	TeamUser
	Login bool `json:"login"`
}

// InviteLinkReq 生成邀请链接请求
type InviteLinkReq struct {
	GroupID  uuid.UUID  `param:"group_id" validate:"required" json:"-" swaggerignore:"true"` // 团队组ID
	ExpireAt *time.Time `json:"expire_at" validate:"omitempty"`                              // 邀请链接过期时间
}

// Validate 验证邀请链接请求
func (i *InviteLinkReq) Validate() error {
	if i.ExpireAt == nil {
		expireAt := time.Now().Add(5 * time.Minute)
		i.ExpireAt = &expireAt
	}
	return nil
}

// TeamInviteLinkResp 团队邀请链接响应
type TeamInviteLinkResp struct {
	InviteLink string `json:"invite_link"`
}

// TeamLogoutResp 团队用户登出响应
type TeamLogoutResp struct {
	Message string `json:"message"`
}

// AddTeamUserReq 创建团队成员请求
type AddTeamUserReq struct {
	Emails  []string  `json:"emails" validate:"required"`    // 邮箱列表
	GroupID uuid.UUID `json:"group_id" validate:"omitempty"` // 团队组ID
}

// AddTeamUserResp 创建团队成员响应
type AddTeamUserResp struct {
	Users []*TeamUser `json:"users"`
}

// AddTeamAdminReq 创建团队管理员请求
type AddTeamAdminReq struct {
	Email string `json:"email" validate:"required,email"` // 邮箱
	Name  string `json:"name" validate:"required"`        // 姓名
}

// AddTeamAdminResp 创建团队管理员响应
type AddTeamAdminResp struct {
	User *TeamUser `json:"user"`
}

// MemberListReq 获取团队成员列表请求
type MemberListReq struct {
	Role consts.TeamMemberRole `query:"role" validate:"omitempty"`
}

// MemberListResp 获取团队成员列表响应
type MemberListResp struct {
	Members     []*TeamMemberInfo `json:"members"`
	MemberLimit int               `json:"member_limit"`
}

// TeamMemberInfo 团队成员信息
type TeamMemberInfo struct {
	User         *User                 `json:"user"`
	Role         consts.TeamMemberRole `json:"role"`
	CreatedAt    int64                 `json:"created_at"`
	LastActiveAt int64                 `json:"last_active_at"`
}

// ChangePasswordReq 修改密码请求
type ChangePasswordReq struct {
	CurrentPassword string `json:"current_password" validate:"omitempty"`         // 当前密码
	NewPassword     string `json:"new_password" validate:"required,min=8,max=32"` // 新密码
}

// ChangePasswordResp 修改密码响应
type ChangePasswordResp struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// UpdateTeamUserReq 更新团队用户信息请求
type UpdateTeamUserReq struct {
	UserID    uuid.UUID `param:"user_id" validate:"required" json:"-" swaggerignore:"true"`
	IsBlocked *bool     `json:"is_blocked" validate:"omitempty"`
}

// UpdateTeamUserResp 更新团队用户信息响应
type UpdateTeamUserResp struct {
	User *User `json:"user"`
}

// ResetPasswordReq 重置密码请求
type ResetPasswordReq struct {
	UserIDs []uuid.UUID `json:"user_ids" validate:"required"` // 用户ID列表
}

// InviteLinkToken 邀请链接令牌
type InviteLinkToken struct {
	TeamID  uuid.UUID `json:"team_id"`
	GroupID uuid.UUID `json:"group_id"`
}
