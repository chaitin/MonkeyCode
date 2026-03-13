package v1

import (
	"fmt"
	"log/slog"
	"net/http"

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
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
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

// PasswordLogin 密码登录
func (h *AuthHandler) PasswordLogin(c *web.Context, req *domain.TeamLoginReq) error {
	ctx := c.Request().Context()

	// 验证验证码
	if req.CaptchaToken != "" {
		ok, err := h.captcha.Verify(req.CaptchaToken, nil)
		if err != nil || !ok {
			h.logger.WarnContext(ctx, "captcha verification failed", "error", err)
			return errcode.ErrCaptchaVerifyFailed
		}
	}

	user, err := h.usecase.PasswordLogin(ctx, req)
	if err != nil {
		h.logger.WarnContext(ctx, "password login failed", "email", req.Email, "error", err)
		return errcode.ErrLoginFailed
	}

	// 生成 Cookie
	cookie, err := h.authMiddleware.GenerateCookieByUID(ctx, user.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "generate cookie failed", "error", err)
		return errcode.ErrInternalServer
	}

	// 保存到 Redis
	err = h.authMiddleware.SetUserCookieIntoRedis(ctx, cookie, middleware.UserSessionKey, user)
	if err != nil {
		h.logger.ErrorContext(ctx, "set user cookie into redis failed", "error", err)
		return errcode.ErrInternalServer
	}

	// 设置 Cookie
	h.setCookie(c, cookie)

	return c.JSON(http.StatusOK, user)
}

// ChangePassword 修改密码
func (h *AuthHandler) ChangePassword(c *web.Context, req *domain.ChangePasswordReq) error {
	ctx := c.Request().Context()

	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}

	err := h.usecase.ChangePassword(ctx, user.ID, req, false)
	if err != nil {
		h.logger.ErrorContext(ctx, "change password failed", "error", err)
		return errcode.ErrChangePasswordFailed
	}

	return c.JSON(http.StatusOK, map[string]bool{"success": true})
}

// Logout 登出
func (h *AuthHandler) Logout(c *web.Context) error {
	ctx := c.Request().Context()

	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}

	cookie, err := c.Cookie(consts.MonkeyCodeAISession)
	if err == nil && cookie.Value != "" {
		err = h.authMiddleware.DeleteUserCookieFromRedis(ctx, middleware.UserSessionKey, user.ID)
		if err != nil {
			h.logger.ErrorContext(ctx, "delete user cookie from redis failed", "error", err)
		}
	}

	h.clearCookie(c)

	return c.JSON(http.StatusOK, map[string]string{"message": "logout success"})
}

// Status 获取用户状态
func (h *AuthHandler) Status(c *web.Context) error {
	user := middleware.GetUser(c)
	if user == nil {
		return c.JSON(http.StatusOK, map[string]bool{"login": false})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"login": true,
		"user":  user,
	})
}

// SendResetPasswordEmail 发送重置密码邮件
func (h *AuthHandler) SendResetPasswordEmail(c *web.Context, req *domain.ResetUserPasswordEmailReq) error {
	ctx := c.Request().Context()

	// 验证验证码
	if req.CaptchaToken != "" {
		ok, err := h.captcha.Verify(req.CaptchaToken, nil)
		if err != nil || !ok {
			h.logger.WarnContext(ctx, "captcha verification failed", "error", err)
			return errcode.ErrCaptchaVerifyFailed
		}
	}

	err := h.usecase.SendResetPasswordEmail(ctx, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "send reset password email failed", "error", err)
		return errcode.ErrInternalServer
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "email sent"})
}

// GetAccountInfo 获取账户信息
func (h *AuthHandler) GetAccountInfo(c *web.Context, param domain.GetAccountInfoReq) error {
	ctx := c.Request().Context()

	key := fmt.Sprintf("reset_password_token:%s", param.Token)
	tokenStr, err := h.redis.Get(ctx, key).Result()
	if err != nil {
		h.logger.WarnContext(ctx, "token not found", "token", param.Token)
		return errcode.ErrInvalidToken
	}

	// 验证 token
	_, err = crypto.ValidateSimple(tokenStr)
	if err != nil {
		h.logger.WarnContext(ctx, "token validation failed", "error", err)
		return errcode.ErrInvalidToken
	}

	return c.JSON(http.StatusOK, map[string]string{"token": param.Token})
}

// ResetPassword 重置密码
func (h *AuthHandler) ResetPassword(c *web.Context, req *domain.ResetUserPasswordReq) error {
	ctx := c.Request().Context()

	key := fmt.Sprintf("reset_password_token:%s", req.Token)
	tokenStr, err := h.redis.Get(ctx, key).Result()
	if err != nil {
		h.logger.WarnContext(ctx, "token not found", "token", req.Token)
		return errcode.ErrInvalidToken
	}

	// 验证 token
	userIDStr, err := crypto.ValidateSimple(tokenStr)
	if err != nil {
		h.logger.WarnContext(ctx, "token validation failed", "error", err)
		return errcode.ErrInvalidToken
	}

	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		h.logger.WarnContext(ctx, "invalid user id", "error", err)
		return errcode.ErrInvalidToken
	}

	err = h.usecase.ChangePassword(ctx, userID, &domain.ChangePasswordReq{NewPassword: req.NewPassword}, true)
	if err != nil {
		h.logger.ErrorContext(ctx, "reset password failed", "error", err)
		return errcode.ErrResetPasswordFailed
	}

	// 删除 token
	h.redis.Del(ctx, key)

	return c.JSON(http.StatusOK, map[string]bool{"success": true})
}

func (h *AuthHandler) setCookie(c *web.Context, cookie string) {
	c.SetCookie(&http.Cookie{
		Name:     consts.MonkeyCodeAISession,
		Value:    cookie,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   h.config.Session.Expire,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) clearCookie(c *web.Context) {
	c.SetCookie(&http.Cookie{
		Name:     consts.MonkeyCodeAISession,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

func (h *AuthHandler) getBaseURL(c *web.Context) string {
	return h.config.Server.BaseURL
}
