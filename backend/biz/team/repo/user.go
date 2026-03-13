package repo

import (
	"context"
	"log/slog"
	"net/mail"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"
	"github.com/samber/lo"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmember"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
)

// TeamGroupUserRepo 团队分组成员数据访问层
type TeamGroupUserRepo struct {
	client *db.Client
	redis  *redis.Client
	config *config.Config
	logger *slog.Logger
}

// NewTeamGroupUserRepo 创建团队分组成员数据访问层 (samber/do 风格)
func NewTeamGroupUserRepo(i *do.Injector) (domain.TeamGroupUserRepo, error) {
	return &TeamGroupUserRepo{
		client: do.MustInvoke[*db.Client](i),
		redis:  do.MustInvoke[*redis.Client](i),
		config: do.MustInvoke[*config.Config](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.team_group_user"),
	}, nil
}

// List 获取团队分组列表
func (r *TeamGroupUserRepo) List(ctx context.Context, teamID uuid.UUID) ([]*db.TeamGroup, error) {
	return r.client.TeamGroup.Query().
		Where(teamgroup.TeamIDEQ(teamID)).
		WithMembers(
			func(uq *db.UserQuery) {
				uq.Order(user.ByCreatedAt(sql.OrderDesc()))
			},
		).
		Order(teamgroup.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
}

// Get 获取团队分组
func (r *TeamGroupUserRepo) Get(ctx context.Context, groupID uuid.UUID) (*db.TeamGroup, error) {
	return r.client.TeamGroup.Get(ctx, groupID)
}

// Create 创建团队分组
func (r *TeamGroupUserRepo) Create(ctx context.Context, teamID uuid.UUID, req *domain.AddTeamGroupReq) (*db.TeamGroup, error) {
	return r.client.TeamGroup.Create().
		SetTeamID(teamID).
		SetName(req.Name).
		Save(ctx)
}

// CreateUsers 创建团队成员
func (r *TeamGroupUserRepo) CreateUsers(ctx context.Context, teamID uuid.UUID, req *domain.AddTeamUserReq) ([]*db.User, error) {
	var users []*db.User

	for _, emailAddr := range req.Emails {
		// 检查邮箱是否已注册
		existingUser, err := r.client.User.Query().Where(user.EmailEQ(emailAddr)).First(ctx)
		if err == nil && existingUser != nil {
			// 用户已存在，检查是否已在团队中
			_, err := r.client.TeamMember.Query().Where(
				teammember.TeamIDEQ(teamID),
				teammember.UserIDEQ(existingUser.ID),
			).First(ctx)
			if err == nil {
				continue // 用户已在团队中
			}
			// 添加到团队
			_, err = r.client.TeamMember.Create().
				SetTeamID(teamID).
				SetUserID(existingUser.ID).
				SetRole(consts.TeamMemberRoleUser).
				Save(ctx)
			if err != nil {
				r.logger.ErrorContext(ctx, "add user to team failed", "error", err)
				continue
			}
			users = append(users, existingUser)
			continue
		}

		// 创建新用户
		newUser, err := r.client.User.Create().
			SetName(emailAddr).
			SetEmail(emailAddr).
			SetPassword("").
			SetRole(consts.UserRoleIndividual).
			Save(ctx)
		if err != nil {
			r.logger.ErrorContext(ctx, "create user failed", "error", err, "email", emailAddr)
			continue
		}

		// 添加到团队
		_, err = r.client.TeamMember.Create().
			SetTeamID(teamID).
			SetUserID(newUser.ID).
			SetRole(consts.TeamMemberRoleUser).
			Save(ctx)
		if err != nil {
			r.logger.ErrorContext(ctx, "add user to team failed", "error", err)
			continue
		}
		users = append(users, newUser)
	}
	return users, nil
}

// CreateAdmin 创建团队管理员
func (r *TeamGroupUserRepo) CreateAdmin(ctx context.Context, teamID uuid.UUID, req *domain.AddTeamAdminReq) (*db.User, error) {
	// 检查邮箱是否已注册
	existingUser, err := r.client.User.Query().Where(user.EmailEQ(req.Email)).First(ctx)
	if err == nil && existingUser != nil {
		// 检查是否已在团队中
		_, err := r.client.TeamMember.Query().Where(
			teammember.TeamIDEQ(teamID),
			teammember.UserIDEQ(existingUser.ID),
		).First(ctx)
		if err == nil {
			return nil, errcode.ErrUserAlreadyExists
		}
		// 添加到团队
		_, err = r.client.TeamMember.Create().
			SetTeamID(teamID).
			SetUserID(existingUser.ID).
			SetRole(consts.TeamMemberRoleAdmin).
			Save(ctx)
		if err != nil {
			return nil, err
		}
		return existingUser, nil
	}

	// 创建新用户
	newUser, err := r.client.User.Create().
		SetName(req.Name).
		SetEmail(req.Email).
		SetPassword("").
		SetRole(consts.UserRoleIndividual).
		Save(ctx)
	if err != nil {
		return nil, err
	}

	// 添加到团队
	_, err = r.client.TeamMember.Create().
		SetTeamID(teamID).
		SetUserID(newUser.ID).
		SetRole(consts.TeamMemberRoleAdmin).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	return newUser, nil
}

// Update 更新团队分组
func (r *TeamGroupUserRepo) Update(ctx context.Context, req *domain.UpdateTeamGroupReq) (*db.TeamGroup, error) {
	return r.client.TeamGroup.UpdateOneID(req.GroupID).
		SetName(req.Name).
		Save(ctx)
}

// Delete 删除团队分组
func (r *TeamGroupUserRepo) Delete(ctx context.Context, teamID, groupID uuid.UUID) error {
	err := r.client.TeamGroup.DeleteOneID(groupID).Exec(ctx)
	return err
}

// ListGroupUsers 获取团队组成员列表
func (r *TeamGroupUserRepo) ListGroupUsers(ctx context.Context, groupID uuid.UUID) ([]*db.TeamGroupMember, error) {
	return r.client.TeamGroupMember.Query().
		Where(teamgroupmember.GroupIDEQ(groupID)).
		WithUser().
		All(ctx)
}

// ModifyGroupUsers 添加团队组成员
func (r *TeamGroupUserRepo) ModifyGroupUsers(ctx context.Context, groupID uuid.UUID, userIDs []uuid.UUID) ([]*db.TeamGroupMember, error) {
	var members []*db.TeamGroupMember

	for _, userID := range userIDs {
		// 检查是否已在组中
		existing, err := r.client.TeamGroupMember.Query().
			Where(
				teamgroupmember.GroupIDEQ(groupID),
				teamgroupmember.UserIDEQ(userID),
			).First(ctx)
		if err == nil && existing != nil {
			members = append(members, existing)
			continue
		}

		// 添加到组
		member, err := r.client.TeamGroupMember.Create().
			SetGroupID(groupID).
			SetUserID(userID).
			Save(ctx)
		if err != nil {
			r.logger.ErrorContext(ctx, "add user to group failed", "error", err, "user_id", userID)
			continue
		}
		members = append(members, member)
	}
	return members, nil
}

// DeleteGroupUser 删除团队组成员
func (r *TeamGroupUserRepo) DeleteGroupUser(ctx context.Context, groupID, userID uuid.UUID) error {
	_, err := r.client.TeamGroupMember.Delete().
		Where(
			teamgroupmember.GroupIDEQ(groupID),
			teamgroupmember.UserIDEQ(userID),
		).Exec(ctx)
	return err
}

// Login 团队用户登录
func (r *TeamGroupUserRepo) Login(ctx context.Context, req *domain.TeamLoginReq) (*db.User, error) {
	usr, err := r.client.User.Query().
		Where(user.EmailEQ(req.Email)).
		Where(user.RoleNEQ(consts.UserRoleEnterprise)).
		WithTeamMembers(func(q *db.TeamMemberQuery) {
			q.WithTeam()
		}).
		First(ctx)
	if err != nil {
		return nil, errcode.ErrLoginFailed.Wrap(err)
	}

	err = crypto.VerifyPassword(usr.Password, req.Password)
	if err != nil {
		r.logger.Error("invalid password", "email", req.Email, "error", err)
		return nil, errcode.ErrLoginFailed
	}
	return usr, nil
}

// MemberList 获取团队成员列表
func (r *TeamGroupUserRepo) MemberList(ctx context.Context, teamID uuid.UUID, role consts.TeamMemberRole) ([]*db.TeamMember, error) {
	query := r.client.TeamMember.Query().
		Where(teammember.TeamIDEQ(teamID)).
		WithUser()

	if role != "" {
		query = query.Where(teammember.RoleEQ(role))
	}

	return query.All(ctx)
}

// ChangePassword 修改密码
func (r *TeamGroupUserRepo) ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword, newPassword string) error {
	uu, err := r.client.User.Query().Where(user.IDEQ(userID)).First(ctx)
	if err != nil {
		return err
	}

	if uu.Password != "" {
		err = crypto.VerifyPassword(uu.Password, currentPassword)
		if err != nil {
			return errcode.ErrInvalidPassword
		}
	}

	hashedNewPassword, err := crypto.HashPassword(newPassword)
	if err != nil {
		return errcode.ErrPasswordHashFailed
	}

	return r.client.User.UpdateOneID(userID).SetPassword(hashedNewPassword).Exec(ctx)
}

// GetTeam 获取团队
func (r *TeamGroupUserRepo) GetTeam(ctx context.Context, teamID uuid.UUID) (*db.Team, error) {
	return r.client.Team.Get(ctx, teamID)
}

// UpdateUser 更新团队用户信息
func (r *TeamGroupUserRepo) UpdateUser(ctx context.Context, userID uuid.UUID, req *domain.UpdateTeamUserReq) (*db.User, error) {
	update := r.client.User.UpdateOneID(userID)
	if req.IsBlocked != nil {
		update = update.SetIsBlocked(*req.IsBlocked)
	}
	return update.Save(ctx)
}

// GetMembersByIDs 根据用户ID列表获取团队成员
func (r *TeamGroupUserRepo) GetMembersByIDs(ctx context.Context, teamID uuid.UUID, userIDs []uuid.UUID) ([]*db.TeamMember, error) {
	return r.client.TeamMember.Query().
		Where(
			teammember.TeamIDEQ(teamID),
			teammember.UserIDIn(userIDs...),
		).
		WithUser().
		All(ctx)
}

// GetMember 获取团队成员
func (r *TeamGroupUserRepo) GetMember(ctx context.Context, teamID, userID uuid.UUID) (*db.TeamMember, error) {
	return r.client.TeamMember.Query().
		Where(
			teammember.TeamIDEQ(teamID),
			teammember.UserIDEQ(userID),
		).
		WithUser().
		First(ctx)
}

// isValidEmail 验证邮箱格式
func isValidEmail(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}

// parseEmails 解析邮箱列表
func parseEmails(emails string) []string {
	return lo.Filter(strings.Split(emails, ","), func(email string, _ int) bool {
		email = strings.TrimSpace(email)
		return email != "" && isValidEmail(email)
	})
}
