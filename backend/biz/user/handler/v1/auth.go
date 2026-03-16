package v1

import (
	"fmt"
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
)

// AuthHandler 认证处理器
type AuthHandler struct {
	config         *config.Config
	logger         *slog.Logger
	usecase        domain.UserUsecase
	redis          *redis.Client
	authMiddleware *middleware.AuthMiddleware
	captcha        *captcha.Captcha
}

// NewAuthHandler 创建认证处理器 (samber/do 风格)
func NewAuthHandler(i *do.Injector) (*AuthHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	cfg := do.MustInvoke[*config.Config](i)
	logger := do.MustInvoke[*slog.Logger](i)
	usecase := do.MustInvoke[domain.UserUsecase](i)
	redisClient := do.MustInvoke[*redis.Client](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	captchaSvc := do.MustInvoke[*captcha.Captcha](i)

	h := &AuthHandler{
		config:         cfg,
		logger:         logger.With("module", "auth.handler"),
		usecase:        usecase,
		redis:          redisClient,
		authMiddleware: auth,
		captcha:        captchaSvc,
	}

	v1 := w.Group("/api/v1/users")

	// 重置密码接口不需要鉴权
	v1.PUT("/passwords/reset-request", web.BindHandler(h.SendResetPasswordEmail))
	v1.GET("/passwords/accounts/:token", web.BindHandler(h.GetAccountInfo))
	v1.PUT("/passwords/reset", web.BindHandler(h.ResetPassword))

	// 密码登录
	v1.POST("/password-login", web.BindHandler(h.PasswordLogin))
	v1.PUT("/passwords/change", web.BindHandler(h.ChangePassword), auth.Check())
	v1.GET("/status", web.BaseHandler(h.Status), auth.Check())
	v1.POST("/logout", web.BaseHandler(h.Logout), auth.Auth())

	return h, nil
}

// PasswordLogin 密码登录接口
//
//	@Summary		密码登录
//	@Description	密码登录
//	@Tags			【用户】企业团队成员认证
//	@Accept			json
//	@Produce		json
//	@Param			req	body		domain.TeamLoginReq	true	"登录请求"
//	@Success		200	{object}	domain.TeamUserInfo
//	@Router			/api/v1/users/password-login [post]
func (h *AuthHandler) PasswordLogin(c *web.Context, req domain.TeamLoginReq) error {
	ctx := c.Request().Context()
	if !h.captcha.ValidateToken(ctx, req.CaptchaToken) {
		return errcode.ErrForbidden
	}

	user, err := h.usecase.PasswordLogin(ctx, &req)
	if err != nil {
		h.logger.WarnContext(ctx, "password login failed", "email", req.Email, "error", err)
		return errcode.ErrLoginFailed
	}
	if user.IsBlocked {
		return errcode.ErrUserBlocked
	}

	_, err = h.authMiddleware.Session.Save(c, consts.MonkeyCodeAISession, user.ID, user)
	if err != nil {
		h.logger.ErrorContext(ctx, "save session failed", "error", err)
		return errcode.ErrInternalServer
	}

	return c.Success(user)
}

// ChangePassword 修改密码接口
//
//	@Summary		修改密码
//	@Description	修改当前用户的密码
//	@Tags			【用户】认证
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.ChangePasswordReq	true	"修改密码请求"
//	@Success		200	{object}	web.Resp{}
//	@Router			/api/v1/users/passwords/change [put]
func (h *AuthHandler) ChangePassword(c *web.Context, req domain.ChangePasswordReq) error {
	ctx := c.Request().Context()

	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}

	err := h.usecase.ChangePassword(ctx, user.ID, &req, false)
	if err != nil {
		h.logger.ErrorContext(ctx, "change password failed", "error", err)
		return errcode.ErrChangePasswordFailed
	}

	return c.Success(nil)
}

// Logout 登出接口
//
//	@Summary		用户登出
//	@Description	清除用户会话，登出系统
//	@Tags			【用户】认证
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	map[string]string
//	@Router			/api/v1/users/logout [post]
func (h *AuthHandler) Logout(c *web.Context) error {
	ctx := c.Request().Context()

	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}

	err := h.authMiddleware.Session.Del(c, consts.MonkeyCodeAISession, user.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "delete session failed", "error", err)
	}

	return c.Success(nil)
}

// Status 检查登录状态接口
//
//	@Summary		检查用户登录状态
//	@Description	检查当前用户是否已登录，返回认证状态和用户信息
//	@Tags			【用户】认证
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.TeamUserInfo}	"成功"
//	@Router			/api/v1/users/status [get]
func (h *AuthHandler) Status(c *web.Context) error {
	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}

	if user.IsBlocked {
		return errcode.ErrUnauthorized
	}

	// 带上 user 相关的 team 关系
	teamUser, err := h.usecase.GetUserWithTeams(c.Request().Context(), user.ID)
	if err != nil {
		return errcode.ErrDatabaseQuery
	}

	if teamUser != nil {
		teamUser.User.Token = ""
	}

	return c.Success(teamUser)
}

// SendResetPasswordEmail 发送重置密码邮件
//
//	@Summary		发送重置密码邮件
//	@Description	重置指定用户的密码，并发送重置邮件
//	@Tags			【用户】密码管理
//	@Accept			json
//	@Produce		json
//	@Param			req	body		domain.ResetUserPasswordEmailReq	true	"重置密码请求"
//	@Success		200	{object}	web.Resp{}							"成功"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/passwords/reset-request [put]
func (h *AuthHandler) SendResetPasswordEmail(c *web.Context, req domain.ResetUserPasswordEmailReq) error {
	ctx := c.Request().Context()
	if !h.captcha.ValidateToken(ctx, req.CaptchaToken) {
		return errcode.ErrForbidden
	}

	err := h.usecase.SendResetPasswordEmail(ctx, &req)
	if err != nil {
		h.logger.ErrorContext(ctx, "send reset password email failed", "error", err)
		return errcode.ErrInternalServer
	}

	return c.Success(nil)
}

// GetAccountInfo 通过 token 查询账户信息接口
//
//	@Summary		通过 token 查询账户信息
//	@Description	通过传入的 token 查询账户信息
//	@Tags			【用户】密码管理
//	@Accept			json
//	@Produce		json
//	@Param			token	path		string								true	"用户 token"
//	@Success		200		{object}	web.Resp{data=domain.TeamUserInfo}	"成功"
//	@Failure		400		{object}	web.Resp							"请求参数错误"
//	@Failure		401		{object}	web.Resp							"未授权，token 无效或已过期"
//	@Router			/api/v1/users/passwords/accounts/{token} [get]
func (h *AuthHandler) GetAccountInfo(c *web.Context, req domain.GetAccountInfoReq) error {
	ctx := c.Request().Context()
	logger := h.logger.With("fn", "GetAccountInfo", "token", req.Token)
	key := fmt.Sprintf("reset_password_token:%s", req.Token)
	userId, err := h.redis.Get(ctx, key).Result()
	if err != nil {
		logger.With("error", err).ErrorContext(ctx, "failed to get reset token")
		return errcode.ErrInvalidToken.Wrap(err)
	}

	id, err := uuid.Parse(userId)
	if err != nil {
		logger.With("error", err).ErrorContext(ctx, "failed to parse user id")
		return errcode.ErrInvalidToken.Wrap(err)
	}

	// 获取用户信息（包含团队信息）
	user, err := h.usecase.GetUserWithTeams(ctx, id)
	if err != nil {
		logger.ErrorContext(ctx, "get user with teams failed", "error", err, "user_id", id)
		return errcode.ErrDatabaseQuery.Wrap(err)
	}

	logger.With("user", user).DebugContext(ctx, "get account info by token")

	if user == nil {
		return errcode.ErrNotFound
	}

	// 检查用户是否被禁用
	if user.User.IsBlocked {
		return errcode.ErrUserBlocked
	}

	// 清除 token 字段，不返回给客户端
	if user.User != nil {
		user.User.Token = ""
	}

	return c.Success(user)
}

// ResetPassword 重置密码接口
//
//	@Summary		重置密码
//	@Description	重置当前用户的密码
//	@Tags			【用户】密码管理
//	@Accept			json
//	@Produce		json
//	@Param			req	body		domain.ResetUserPasswordReq	true	"重置密码请求"
//	@Success		200	{object}	web.Resp{}
//	@Router			/api/v1/users/passwords/reset [put]
func (h *AuthHandler) ResetPassword(c *web.Context, req domain.ResetUserPasswordReq) error {
	// 重置前检查 redis 里的 Key
	key := fmt.Sprintf("reset_password_token:%s", req.Token)
	userID, err := h.redis.Get(c.Request().Context(), key).Result()
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "get redis key failed", "error", err)
		return errcode.ErrResetPasswordFailed
	}
	id, err := uuid.Parse(userID)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "invalid token", "error", err)
		return errcode.ErrResetPasswordFailed
	}

	// 不允许从这个接口重置管理员的密码
	teamUser, err := h.usecase.GetUserWithTeams(c.Request().Context(), id)
	if err != nil {
		return err
	}
	if teamUser.User.Role == consts.UserRoleEnterprise {
		return errcode.ErrResetPasswordFailed
	}

	err = h.usecase.ChangePassword(c.Request().Context(), id, &domain.ChangePasswordReq{NewPassword: req.NewPassword}, true)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "change password failed", "error", err)
		return err
	}

	// 重置后清除 redis 里的 key
	err = h.redis.Del(c.Request().Context(), key).Err()
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "delete redis key failed", "error", err)
		return errcode.ErrResetPasswordFailed.Wrap(err)
	}
	h.logger.InfoContext(c.Request().Context(), "delete redis key success", "key", key)

	if err := h.authMiddleware.Session.Trunc(c.Request().Context(), consts.MonkeyCodeAISession, id); err != nil {
		return err
	}

	return c.Success(nil)
}
