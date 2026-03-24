package repo

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
)

type userRepo struct {
	db     *db.Client
	logger *slog.Logger
	redis  *redis.Client
	config *config.Config
}

func NewUserRepo(i *do.Injector) (domain.UserRepo, error) {
	return &userRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i),
		redis:  do.MustInvoke[*redis.Client](i),
		config: do.MustInvoke[*config.Config](i),
	}, nil
}

// Get implements domain.UserRepo.
func (u *userRepo) Get(ctx context.Context, uid uuid.UUID) (*db.User, error) {
	return u.db.User.Get(ctx, uid)
}

// Update implements domain.UserRepo.
func (u *userRepo) Update(ctx context.Context, uid uuid.UUID, name, avatarURL string) error {
	update := u.db.User.UpdateOneID(uid)
	if name != "" {
		update = update.SetName(name)
	}
	if avatarURL != "" {
		update = update.SetAvatarURL(avatarURL)
	}
	return update.Exec(ctx)
}

// GetUserWithTeams implements domain.UserRepo.
func (u *userRepo) GetUserWithTeams(ctx context.Context, userID uuid.UUID) (*db.User, error) {
	return u.db.User.Query().
		Where(user.IDEQ(userID)).
		WithTeamMembers(func(q *db.TeamMemberQuery) {
			q.WithTeam()
		}).
		WithTeams().
		First(ctx)
}

// PasswordLogin implements domain.UserRepo.
func (u *userRepo) PasswordLogin(ctx context.Context, req *domain.TeamLoginReq) (*db.User, error) {
	usr, err := u.db.User.Query().
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
		u.logger.Error("invalid password", "email", req.Email, "error", err)
		return nil, errcode.ErrLoginFailed
	}
	return usr, nil
}

// ChangePassword implements domain.UserRepo.
func (u *userRepo) ChangePassword(ctx context.Context, userID uuid.UUID, currentPassword, newPassword string, isReset bool) error {
	uu, err := u.db.User.Query().Where(user.IDEQ(userID)).First(ctx)
	if err != nil {
		return err
	}

	if !isReset && uu.Password != "" {
		err = crypto.VerifyPassword(uu.Password, currentPassword)
		if err != nil {
			return errcode.ErrInvalidPassword
		}
	}

	hashedNewPassword, err := crypto.HashPassword(newPassword)
	if err != nil {
		return errcode.ErrLoginFailed
	}
	err = u.db.User.UpdateOneID(userID).
		SetPassword(hashedNewPassword).
		Exec(ctx)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}

// GetUserByEmail implements domain.UserRepo.
func (u *userRepo) GetUserByEmail(ctx context.Context, emails []string) ([]*db.User, error) {
	return u.db.User.Query().WithTeams().Where(user.EmailIn(emails...)).All(ctx)
}

// SetEmail implements domain.UserRepo.
func (u *userRepo) SetEmail(ctx context.Context, userID uuid.UUID, email string) error {
	return u.db.User.UpdateOneID(userID).SetEmail(email).Exec(ctx)
}
