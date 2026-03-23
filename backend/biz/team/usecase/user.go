package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// TeamGroupUserUsecase 团队分组成员业务逻辑层
type TeamGroupUserUsecase struct {
	repo        domain.TeamGroupUserRepo
	logger      *slog.Logger
	config      *config.Config
	smtpClient  domain.EmailSender
	redisClient *redis.Client
}

// NewTeamGroupUserUsecase 创建团队分组成员业务逻辑层实例
func NewTeamGroupUserUsecase(i *do.Injector) (domain.TeamGroupUserUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)

	t := &TeamGroupUserUsecase{
		repo:        do.MustInvoke[domain.TeamGroupUserRepo](i),
		logger:      do.MustInvoke[*slog.Logger](i).With("module", "usecase.team_group_user"),
		config:      cfg,
		smtpClient:  do.MustInvoke[domain.EmailSender](i),
		redisClient: do.MustInvoke[*redis.Client](i),
	}

	go t.initTeam()

	return t, nil
}

func (u *TeamGroupUserUsecase) initTeam() {
	if u.config.InitTeam.Email == "" || u.config.InitTeam.Password == "" {
		return
	}

	name := u.config.InitTeam.Name
	if name == "" {
		name = u.config.InitTeam.Email
	}

	ctx := context.Background()
	if err := u.repo.InitTeam(ctx, u.config.InitTeam.Email, name, u.config.InitTeam.Password); err != nil {
		u.logger.ErrorContext(ctx, "init team failed", "error", err)
		return
	}
	u.logger.InfoContext(ctx, "init team success", "email", u.config.InitTeam.Email)
}

// List 获取团队分组列表
func (u *TeamGroupUserUsecase) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamGroupsResp, error) {
	groups, err := u.repo.List(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	return &domain.ListTeamGroupsResp{
		Groups: cvt.Iter(groups, func(_ int, group *db.TeamGroup) *domain.TeamGroup {
			return cvt.From(group, &domain.TeamGroup{})
		}),
	}, nil
}

// Add 创建团队分组
func (u *TeamGroupUserUsecase) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamGroupReq) (*domain.TeamGroup, error) {
	group, err := u.repo.Create(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	return cvt.From(group, &domain.TeamGroup{}), nil
}

// AddUser 创建团队成员
func (u *TeamGroupUserUsecase) AddUser(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamUserReq) (*domain.AddTeamUserResp, error) {
	users, err := u.repo.CreateUsers(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	// 发送重置密码邮件（如果没有发送成功就用户自己请求重置）
	for _, user := range users {
		if user.Email != "" {
			token, err := u.generateResetPWDToken(ctx, user.ID)
			if err != nil {
				u.logger.ErrorContext(ctx, "generate reset password token failed", "error", err)
				continue
			}
			// 存一份到 redis
			key := fmt.Sprintf("reset_password_token:%s", user.ID.String())
			if err := u.redisClient.Set(ctx, key, token, time.Hour*24).Err(); err != nil {
				u.logger.ErrorContext(ctx, "set redis failed", "key", key, "token", token, "error", err)
				continue
			}
			u.logger.InfoContext(ctx, "set redis success", "key", key, "token", token)
			go u.sendResetPasswordEmail(ctx, user.Email, user.Name, token)
		}
	}
	teamUsers := cvt.Iter(users, func(_ int, user *db.User) *domain.TeamUser {
		return cvt.From(user, &domain.TeamUser{})
	})
	return &domain.AddTeamUserResp{Users: teamUsers}, nil
}

// AddAdmin 创建团队管理员
func (u *TeamGroupUserUsecase) AddAdmin(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamAdminReq) (*domain.AddTeamAdminResp, error) {
	user, err := u.repo.CreateAdmin(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	if user.Email != "" {
		token, err := u.generateResetPWDToken(ctx, user.ID)
		if err != nil {
			u.logger.ErrorContext(ctx, "generate reset password token failed", "error", err)
			return nil, err
		}
		// 存一份到 redis
		key := fmt.Sprintf("reset_password_token:%s", user.ID.String())
		if err := u.redisClient.Set(ctx, key, token, time.Hour*24).Err(); err != nil {
			u.logger.ErrorContext(ctx, "set redis failed", "key", key, "token", token, "error", err)
			return nil, err
		}
		u.logger.InfoContext(ctx, "set redis success", "key", key, "token", token)
		go u.sendResetPasswordEmail(ctx, user.Email, user.Name, token)
	}

	teamUserResp := cvt.From(user, &domain.TeamUser{})
	return &domain.AddTeamAdminResp{User: teamUserResp}, nil
}

// Update 更新团队分组
func (u *TeamGroupUserUsecase) Update(ctx context.Context, req *domain.UpdateTeamGroupReq) (*domain.TeamGroup, error) {
	group, err := u.repo.Update(ctx, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(group, &domain.TeamGroup{}), nil
}

// Delete 删除团队分组
func (u *TeamGroupUserUsecase) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamGroupReq) error {
	return u.repo.Delete(ctx, teamUser.GetTeamID(), req.GroupID)
}

// ListGroups 获取团队组成员列表
func (u *TeamGroupUserUsecase) ListGroups(ctx context.Context, req *domain.ListTeamGroupUsersReq) (*domain.ListTeamGroupUsersResp, error) {
	members, err := u.repo.ListGroupUsers(ctx, req.GroupID)
	if err != nil {
		return nil, err
	}
	return &domain.ListTeamGroupUsersResp{
		Users: cvt.Iter(members, func(_ int, member *db.TeamGroupMember) *domain.User {
			return cvt.From(member.Edges.User, &domain.User{})
		}),
	}, nil
}

// ModifyGroups 添加团队组成员
func (u *TeamGroupUserUsecase) ModifyGroups(ctx context.Context, req *domain.AddTeamGroupUsersReq) (*domain.AddTeamGroupUsersResp, error) {
	members, err := u.repo.ModifyGroupUsers(ctx, req.GroupID, req.UserIDs)
	if err != nil {
		return nil, err
	}
	return &domain.AddTeamGroupUsersResp{
		Users: cvt.Iter(members, func(_ int, member *db.TeamGroupMember) *domain.User {
			return cvt.From(member.Edges.User, &domain.User{})
		}),
	}, nil
}

// DeleteGroups 删除团队组成员
func (u *TeamGroupUserUsecase) DeleteGroups(ctx context.Context, req *domain.DeleteTeamGroupUserReq) error {
	return u.repo.DeleteGroupUser(ctx, req.GroupID, req.UserID)
}

// Login 团队用户登录
func (u *TeamGroupUserUsecase) Login(ctx context.Context, req *domain.TeamLoginReq) (*domain.User, error) {
	user, err := u.repo.Login(ctx, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(user, &domain.User{}), nil
}

// MemberList 获取团队成员列表
func (u *TeamGroupUserUsecase) MemberList(ctx context.Context, teamUser *domain.TeamUser, req *domain.MemberListReq) (*domain.MemberListResp, error) {
	team, err := u.repo.GetTeam(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	members, err := u.repo.MemberList(ctx, teamUser.GetTeamID(), req.Role)
	if err != nil {
		return nil, err
	}
	return &domain.MemberListResp{
		MemberLimit: team.MemberLimit,
		Members: cvt.Iter(members, func(_ int, member *db.TeamMember) *domain.TeamMemberInfo {
			return &domain.TeamMemberInfo{
				User:         cvt.From(member.Edges.User, &domain.User{}),
				Role:         member.Role,
				CreatedAt:    member.CreatedAt.Unix(),
				LastActiveAt: 0,
			}
		}),
	}, nil
}

// ChangePassword 修改密码
func (u *TeamGroupUserUsecase) ChangePassword(ctx context.Context, userID uuid.UUID, req *domain.ChangePasswordReq) error {
	err := u.repo.ChangePassword(ctx, userID, req.CurrentPassword, req.NewPassword)
	if err != nil {
		u.logger.ErrorContext(ctx, "change password failed", "error", err)
		return err
	}
	return nil
}

// UpdateUser 更新用户信息
func (u *TeamGroupUserUsecase) UpdateUser(ctx context.Context, req *domain.UpdateTeamUserReq) (*domain.UpdateTeamUserResp, error) {
	user, err := u.repo.UpdateUser(ctx, req.UserID, req)
	if err != nil {
		return nil, err
	}
	return &domain.UpdateTeamUserResp{
		User: cvt.From(user, &domain.User{}),
	}, nil
}

// generateResetPWDToken 生成重置密码的 token
func (u *TeamGroupUserUsecase) generateResetPWDToken(ctx context.Context, userID uuid.UUID) (string, error) {
	token, err := crypto.Simple(userID.String(), time.Now().Add(time.Hour*24*3))
	if err != nil {
		return "", err
	}
	return token, nil
}

// sendResetPasswordEmail 发送重置密码邮件
func (u *TeamGroupUserUsecase) sendResetPasswordEmail(ctx context.Context, email, username, token string) error {
	resetURL := fmt.Sprintf("%s/resetpassword?token=%s", u.config.Server.BaseURL, token)
	err := u.smtpClient.SendResetPasswordEmail(ctx, email, username, resetURL)
	if err != nil {
		u.logger.ErrorContext(ctx, "send reset password email failed", "error", err)
		return errcode.ErrHTTPRequest.Wrap(err)
	}

	u.logger.InfoContext(ctx, "send reset password email success", "email", email, "username", username)
	return nil
}
