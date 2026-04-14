package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
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
	if len(users) != len(req.Emails) {
		return errcode.ErrEmailNotBound
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

// SendBindEmailVerification 发送邮箱绑定验证邮件
func (u *UserUsecase) SendBindEmailVerification(ctx context.Context, userID uuid.UUID, req *domain.SendBindEmailVerificationReq) error {
	// 检查邮箱是否已被其他用户使用
	existingUsers, err := u.repo.GetUserByEmail(ctx, []string{req.Email})
	if err != nil && !db.IsNotFound(err) {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	for _, eu := range existingUsers {
		if eu.ID == userID {
			return errcode.ErrEmailAlreadyBound
		}
		return errcode.ErrEmailTaken
	}

	// 生成验证 token
	token, err := crypto.Simple(userID.String(), time.Now().Add(time.Hour*24))
	if err != nil {
		u.logger.ErrorContext(ctx, "generate bind email token failed", "error", err)
		return errcode.ErrInternalServer.Wrap(err)
	}

	// 存储 token 到 Redis，格式：{token}:{email}，有效期 24 小时
	key := fmt.Sprintf("bind_email_token:%s", userID.String())
	value := fmt.Sprintf("%s:%s", token, req.Email)
	if err := u.redis.Set(ctx, key, value, time.Hour*24).Err(); err != nil {
		u.logger.ErrorContext(ctx, "set redis key failed", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}

	// 获取用户信息用于邮件发送
	user, err := u.repo.Get(ctx, userID)
	if err != nil {
		u.logger.ErrorContext(ctx, "get user failed", "error", err)
		return errcode.ErrDatabaseQuery.Wrap(err)
	}

	// 异步发送邮件
	verifyURL := fmt.Sprintf("%s/api/v1/users/email/verify?token=%s", u.config.Server.BaseURL, token)
	go func() {
		if err := u.email.SendBindEmailVerification(context.Background(), req.Email, user.Name, verifyURL); err != nil {
			u.logger.ErrorContext(ctx, "send bind email verification mail failed", "error", err)
		}
	}()

	return nil
}

// VerifyBindEmail 验证邮箱绑定
func (u *UserUsecase) VerifyBindEmail(ctx context.Context, token string) error {
	// 验证 token 的有效性（检查签名和过期时间）
	userIDStr, err := crypto.ValidateSimple(token)
	if err != nil {
		u.logger.WarnContext(ctx, "validate token failed", "error", err)
		return errcode.ErrEmailVerifyFailed.Wrap(err)
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		u.logger.WarnContext(ctx, "parse user id from token failed", "error", err)
		return errcode.ErrEmailVerifyFailed.Wrap(err)
	}

	// 从 Redis 中取出存储的 token 和邮箱（一次性消费）
	key := fmt.Sprintf("bind_email_token:%s", userID.String())
	redisValue, err := u.redis.GetDel(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return errcode.ErrEmailVerifyFailed
		}
		u.logger.ErrorContext(ctx, "get redis key failed", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}

	// 解析 Redis 中的值：{token}:{email}
	parts := strings.SplitN(redisValue, ":", 2)
	if len(parts) != 2 {
		u.logger.WarnContext(ctx, "invalid redis value format", "value", redisValue)
		return errcode.ErrEmailVerifyFailed
	}

	storedToken := parts[0]
	email := parts[1]

	// 验证 token 是否匹配（防止 token 替换）
	if storedToken != token {
		u.logger.WarnContext(ctx, "token mismatch")
		return errcode.ErrEmailVerifyFailed
	}

	// 再次检查邮箱是否被其他用户占用（防止竞态条件）
	existingUsers, err := u.repo.GetUserByEmail(ctx, []string{email})
	if err != nil && !db.IsNotFound(err) {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	for _, eu := range existingUsers {
		if eu.ID != userID {
			return errcode.ErrEmailTaken
		}
	}

	// 更新用户邮箱
	if err := u.repo.SetEmail(ctx, userID, email); err != nil {
		u.logger.ErrorContext(ctx, "set email failed", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}

	u.logger.InfoContext(ctx, "bind email success", "user_id", userID, "email", email)
	return nil
}
