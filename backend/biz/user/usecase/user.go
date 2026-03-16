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
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type UserUsecase struct {
	repo   domain.UserRepo
	logger *slog.Logger
	redis  *redis.Client
	config *config.Config
	email  domain.EmailSender
}

func NewUserUsecase(i *do.Injector) (domain.UserUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	return &UserUsecase{
		repo:   do.MustInvoke[domain.UserRepo](i),
		logger: do.MustInvoke[*slog.Logger](i),
		redis:  do.MustInvoke[*redis.Client](i),
		config: cfg,
		email:  do.MustInvoke[domain.EmailSender](i),
	}, nil
}

// Get implements domain.UserUsecase.
func (u *UserUsecase) Get(ctx context.Context, uid uuid.UUID) (*domain.User, error) {
	us, err := u.repo.Get(ctx, uid)
	if err != nil {
		return nil, err
	}
	return cvt.From(us, &domain.User{}), nil
}

// Update implements domain.UserUsecase.
func (u *UserUsecase) Update(ctx context.Context, uid uuid.UUID, avatarURL string, req domain.UpdateUserReq) (*domain.User, error) {
	err := u.repo.Update(ctx, uid, req.Name, avatarURL)
	if err != nil {
		u.logger.ErrorContext(ctx, "update user failed", "error", err, "user_id", uid)
		return nil, err
	}

	user, err := u.Get(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "get updated user failed", "error", err, "user_id", uid)
		return nil, err
	}
	return user, nil
}

// GetUserWithTeams implements domain.UserUsecase.
func (u *UserUsecase) GetUserWithTeams(ctx context.Context, userID uuid.UUID) (*domain.TeamUserInfo, error) {
	user, err := u.repo.GetUserWithTeams(ctx, userID)
	if err != nil {
		return nil, err
	}
	return cvt.From(user, &domain.TeamUserInfo{}), nil
}

// PasswordLogin implements domain.UserUsecase.
func (u *UserUsecase) PasswordLogin(ctx context.Context, req *domain.TeamLoginReq) (*domain.User, error) {
	user, err := u.repo.PasswordLogin(ctx, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(user, &domain.User{}), nil
}

// ChangePassword implements domain.UserUsecase.
func (u *UserUsecase) ChangePassword(ctx context.Context, userID uuid.UUID, req *domain.ChangePasswordReq, isReset bool) error {
	err := u.repo.ChangePassword(ctx, userID, req.CurrentPassword, req.NewPassword, isReset)
	if err != nil {
		u.logger.ErrorContext(ctx, "change password failed", "error", err)
		return err
	}
	return nil
}

// SendResetPasswordEmail implements domain.UserUsecase.
func (u *UserUsecase) SendResetPasswordEmail(ctx context.Context, req *domain.ResetUserPasswordEmailReq) error {
	users, err := u.repo.GetUserByEmail(ctx, req.Emails)
	if err != nil {
		return err
	}

	for _, user := range users {
		token := uuid.NewString()
		key := fmt.Sprintf("reset_password_token:%s", token)
		err = u.redis.Set(ctx, key, user.ID.String(), time.Hour*24).Err()
		if err != nil {
			u.logger.ErrorContext(ctx, "set redis key failed", "error", err)
			continue
		}
		u.logger.InfoContext(ctx, "set redis key success", "key", key)
		go u.sendEmail(ctx, user.Email, user.Name, token)
	}
	return nil
}

// sendEmail sends a reset password email via SMTP.
func (u *UserUsecase) sendEmail(ctx context.Context, emailAddr, username, token string) {
	resetURL := fmt.Sprintf("%s/resetpassword?token=%s", u.config.Server.BaseURL, token)
	err := u.email.SendResetPasswordEmail(ctx, emailAddr, username, resetURL)
	if err != nil {
		u.logger.ErrorContext(ctx, "send email failed", "error", err, "email", emailAddr)
		return
	}
	u.logger.InfoContext(ctx, "send email success", "email", emailAddr, "username", username)
}

// GetUserByEmail implements domain.UserUsecase.
func (u *UserUsecase) GetUserByEmail(ctx context.Context, emails []string) ([]*domain.User, error) {
	users, err := u.repo.GetUserByEmail(ctx, emails)
	if err != nil && !db.IsNotFound(err) {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}
	if len(users) == 0 {
		u.logger.InfoContext(ctx, "no user found by email", "emails", emails)
		return nil, nil
	}

	result := make([]*domain.User, 0, len(users))
	cvt.Iter(users, func(_ int, user *db.User) error {
		result = append(result, cvt.From(user, &domain.User{}))
		return nil
	})
	return result, nil
}
