package v1

import (
	"bytes"
	"context"
	"crypto/md5"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/GoYoko/web"
	"golang.org/x/time/rate"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/internal/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
	"github.com/chaitin/MonkeyCode/backend/pkg/version"
	"github.com/chaitin/MonkeyCode/backend/pkg/vsix"
)

// CacheEntry 缓存条目
type CacheEntry struct {
	data      []byte
	createdAt time.Time
}

type UserHandler struct {
	usecase   domain.UserUsecase
	euse      domain.ExtensionUsecase
	duse      domain.DashboardUsecase
	buse      domain.BillingUsecase
	scuse     domain.SecurityScanningUsecase
	session   *session.Session
	logger    *slog.Logger
	cfg       *config.Config
	vsixCache map[string]*CacheEntry
	cacheMu   sync.RWMutex
	limiter   *rate.Limiter
}

func NewUserHandler(
	w *web.Web,
	usecase domain.UserUsecase,
	euse domain.ExtensionUsecase,
	scuse domain.SecurityScanningUsecase,
	duse domain.DashboardUsecase,
	buse domain.BillingUsecase,
	auth *middleware.AuthMiddleware,
	active *middleware.ActiveMiddleware,
	readonly *middleware.ReadOnlyMiddleware,
	session *session.Session,
	logger *slog.Logger,
	cfg *config.Config,
) *UserHandler {
	u := &UserHandler{
		usecase:   usecase,
		euse:      euse,
		duse:      duse,
		buse:      buse,
		scuse:     scuse,
		session:   session,
		logger:    logger,
		cfg:       cfg,
		vsixCache: make(map[string]*CacheEntry),
		limiter:   rate.NewLimiter(rate.Every(time.Duration(cfg.Extension.LimitSecond)*time.Second), cfg.Extension.Limit),
	}

	w.GET("/api/v1/static/vsix/:version", web.BaseHandler(u.VSIXDownload))
	w.GET("/api/v1/static/vsix", web.BaseHandler(u.VSIXDownload))
	w.POST("/api/v1/vscode/init-auth", web.BindHandler(u.VSCodeAuthInit))

	// admin
	admin := w.Group("/api/v1/admin")
	admin.POST("/login", web.BindHandler(u.AdminLogin))
	admin.GET("/setting", web.BaseHandler(u.GetSetting))
	admin.GET("/role", web.BaseHandler(u.ListRole))

	admin.Use(auth.Auth(), active.Active("admin"), readonly.Guard())
	admin.GET("/profile", web.BaseHandler(u.AdminProfile))
	admin.GET("/list", web.BaseHandler(u.AdminList, web.WithPage()))
	admin.GET("/login-history", web.BaseHandler(u.AdminLoginHistory, web.WithPage()))
	admin.PUT("/setting", web.BindHandler(u.UpdateSetting))
	admin.POST("/create", web.BindHandler(u.CreateAdmin))
	admin.POST("/logout", web.BaseHandler(u.AdminLogout))
	admin.DELETE("/delete", web.BaseHandler(u.DeleteAdmin))
	admin.GET("/export-completion-data", web.BaseHandler(u.ExportCompletionData))
	admin.POST("/role", web.BindHandler(u.GrantRole))

	// user
	g := w.Group("/api/v1/user")
	g.GET("/oauth/signup-or-in", web.BindHandler(u.OAuthSignUpOrIn))
	g.GET("/oauth/callback", web.BindHandler(u.OAuthCallback))
	g.POST("/register", web.BindHandler(u.Register))
	g.POST("/login", web.BindHandler(u.Login))

	g.Use(readonly.Guard())
	g.GET("/profile", web.BaseHandler(u.Profile), auth.UserAuth())
	g.PUT("/profile", web.BindHandler(u.UpdateProfile), auth.UserAuth())
	g.POST("/logout", web.BaseHandler(u.Logout), auth.UserAuth())

	g.Use(auth.Auth(), active.Active("admin"))

	g.PUT("/update", web.BindHandler(u.Update))
	g.DELETE("/delete", web.BaseHandler(u.Delete))
	g.GET("/invite", web.BaseHandler(u.Invite))
	g.GET("/list", web.BindHandler(u.List, web.WithPage()))
	g.GET("/login-history", web.BaseHandler(u.LoginHistory, web.WithPage()))

	// user dashboard
	d := w.Group("/api/v1/user/dashboard")
	d.Use(auth.UserAuth(), active.Active("user"))
	d.GET("/stat", web.BindHandler(u.UserStat))
	d.GET("/events", web.BaseHandler(u.UserEvents))
	d.GET("/heatmap", web.BaseHandler(u.UserHeatmap))

	// user record
	uc := w.Group("/api/v1/user/chat")
	uc.Use(auth.UserAuth(), active.Active("user"))
	uc.GET("/record", web.BindHandler(u.ListChatRecord, web.WithPage()))
	uc.GET("/info", web.BaseHandler(u.ChatInfo))

	cplt := w.Group("/api/v1/user/completion")
	cplt.Use(auth.UserAuth(), active.Active("user"))
	cplt.GET("/record", web.BindHandler(u.ListCompletionRecord, web.WithPage()))
	cplt.GET("/info", web.BaseHandler(u.CompletionInfo))

	// user security
	sc := w.Group("/api/v1/user/security")
	sc.Use(auth.UserAuth(), active.Active("user"))
	sc.GET("/scanning", web.BindHandler(u.SecurityList, web.WithPage()))
	sc.GET("/scanning/detail", web.BaseHandler(u.SecurityDetail))

	return u
}

func (h *UserHandler) VSCodeAuthInit(c *web.Context, req domain.VSCodeAuthInitReq) error {
	s, err := h.usecase.GetSetting(c.Request().Context())
	if err != nil {
		return err
	}
	req.BaseURL = h.cfg.GetBaseURL(c.Request(), s)
	resp, err := h.usecase.VSCodeAuthInit(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// generateCacheKey 生成缓存键
func (h *UserHandler) generateCacheKey(version, baseUrl string) string {
	hash := md5.Sum([]byte(version + ":" + baseUrl))
	return fmt.Sprintf("%x", hash)
}

// cleanExpiredCache 清理过期缓存
func (h *UserHandler) cleanExpiredCache() {
	h.cacheMu.Lock()
	defer h.cacheMu.Unlock()

	now := time.Now()
	for key, entry := range h.vsixCache {
		// 缓存1小时后过期
		if now.Sub(entry.createdAt) > time.Hour {
			delete(h.vsixCache, key)
		}
	}
}

// VSIXDownload 下载VSCode插件
//
//	@Tags			User
//	@Summary		下载VSCode插件
//	@Description	下载VSCode插件
//	@ID				vsix-download
//	@Accept			json
//	@Produce		octet-stream
//	@Router			/api/v1/static/vsix [get]
func (h *UserHandler) VSIXDownload(c *web.Context) error {
	if !h.limiter.Allow() {
		return c.String(http.StatusTooManyRequests, "Too Many Requests")
	}

	s, err := h.usecase.GetSetting(c.Request().Context())
	if err != nil {
		return err
	}

	host := c.Request().Host
	h.logger.With("url", c.Request().URL).With("header", c.Request().Header).With("host", host).DebugContext(c.Request().Context(), "vsix download")
	cacheKey := h.generateCacheKey(version.Version, h.cfg.GetBaseURL(c.Request(), s))
	version := strings.Trim(version.Version, "v")

	h.cacheMu.RLock()
	if entry, exists := h.vsixCache[cacheKey]; exists {
		if time.Since(entry.createdAt) < time.Hour {
			h.cacheMu.RUnlock()

			disposition := fmt.Sprintf("attachment; filename=monkeycode-%s.vsix", version)
			c.Response().Header().Set("Content-Type", "application/octet-stream")
			c.Response().Header().Set("Content-Disposition", disposition)
			c.Response().Header().Set("Content-Length", fmt.Sprintf("%d", len(entry.data)))

			_, err := c.Response().Writer.Write(entry.data)
			return err
		}
	}
	h.cacheMu.RUnlock()

	var buf bytes.Buffer
	if err := vsix.ChangeVsixEndpoint(fmt.Sprintf("/app/assets/vsix/monkeycode-%s.vsix", version), "extension/package.json", h.cfg.GetBaseURL(c.Request(), s), &buf); err != nil {
		return err
	}

	data := buf.Bytes()
	h.cacheMu.Lock()
	h.vsixCache[cacheKey] = &CacheEntry{
		data:      data,
		createdAt: time.Now(),
	}
	h.cacheMu.Unlock()

	go h.cleanExpiredCache()

	disposition := fmt.Sprintf("attachment; filename=monkeycode-%s.vsix", version)
	c.Response().Header().Set("Content-Type", "application/octet-stream")
	c.Response().Header().Set("Content-Disposition", disposition)
	c.Response().Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))

	_, err = c.Response().Writer.Write(data)
	return err
}

// Login 用户登录
//
//	@Tags			User
//	@Summary		用户登录
//	@Description	用户登录
//	@ID				login
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.LoginReq	true	"登录参数"
//	@Success		200		{object}	web.Resp{data=domain.LoginResp}
//	@Router			/api/v1/user/login [post]
func (h *UserHandler) Login(c *web.Context, req domain.LoginReq) error {
	req.IP = c.RealIP()
	resp, err := h.usecase.Login(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	if req.Source == consts.LoginSourceBrowser {
		if _, err := h.session.Save(c, consts.UserSessionName, c.Request().Host, resp.User); err != nil {
			return err
		}
	}
	return c.Success(resp)
}

// Logout 用户登出
//
//	@Tags			User
//	@Summary		用户登出
//	@Description	用户登出
//	@ID				logout
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{}
//	@Router			/api/v1/user/logout [post]
func (h *UserHandler) Logout(c *web.Context) error {
	if err := h.session.Del(c, consts.UserSessionName); err != nil {
		return err
	}
	return c.Success(nil)
}

// Update 更新用户
//
//	@Tags			User
//	@Summary		更新用户
//	@Description	更新用户
//	@ID				update-user
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.UpdateUserReq	true	"更新用户参数"
//	@Success		200		{object}	web.Resp{data=domain.User}
//	@Router			/api/v1/user/update [put]
func (h *UserHandler) Update(c *web.Context, req domain.UpdateUserReq) error {
	resp, err := h.usecase.Update(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除用户
//
//	@Tags			User
//	@Summary		删除用户
//	@Description	删除用户
//	@ID				delete-user
//	@Accept			json
//	@Produce		json
//	@Param			id	query		string	true	"用户ID"
//	@Success		200	{object}	web.Resp{data=nil}
//	@Router			/api/v1/user/delete [delete]
func (h *UserHandler) Delete(c *web.Context) error {
	err := h.usecase.Delete(c.Request().Context(), c.QueryParam("id"))
	if err != nil {
		return err
	}
	return c.Success(nil)
}

// DeleteAdmin 删除管理员
//
//	@Tags			Admin
//	@Summary		删除管理员
//	@Description	删除管理员
//	@ID				delete-admin
//	@Accept			json
//	@Produce		json
//	@Param			id	query		string	true	"管理员ID"
//	@Success		200	{object}	web.Resp{data=nil}
//	@Router			/api/v1/admin/delete [delete]
func (h *UserHandler) DeleteAdmin(c *web.Context) error {
	err := h.usecase.DeleteAdmin(c.Request().Context(), c.QueryParam("id"))
	if err != nil {
		return err
	}
	return c.Success(nil)
}

// AdminLogin 管理员登录
//
//	@Tags			Admin
//	@Summary		管理员登录
//	@Description	管理员登录
//	@ID				admin-login
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.LoginReq	true	"登录参数"
//	@Success		200		{object}	web.Resp{data=domain.AdminUser}
//	@Router			/api/v1/admin/login [post]
func (h *UserHandler) AdminLogin(c *web.Context, req domain.LoginReq) error {
	req.IP = c.RealIP()
	resp, err := h.usecase.AdminLogin(c.Request().Context(), &req)
	if err != nil {
		return err
	}

	h.logger.With("header", c.Request().Header).With("host", c.Request().Host).Info("admin login", "username", resp.Username)
	if _, err := h.session.Save(c, consts.SessionName, c.Request().Host, resp); err != nil {
		return err
	}
	return c.Success(resp)
}

// AdminLogout 管理员登出
//
//	@Tags			Admin
//	@Summary		管理员登出
//	@Description	管理员登出
//	@ID				admin-logout
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{}
//	@Router			/api/v1/admin/logout [post]
func (h *UserHandler) AdminLogout(c *web.Context) error {
	if err := h.session.Del(c, consts.SessionName); err != nil {
		return err
	}
	return c.Success(nil)
}

// AdminProfile 管理员信息
//
//	@Tags			Admin
//	@Summary		管理员信息
//	@Description	管理员信息
//	@ID				admin-profile
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.AdminUser}
//	@Router			/api/v1/admin/profile [get]
func (h *UserHandler) AdminProfile(c *web.Context) error {
	user := middleware.GetAdmin(c)
	return c.Success(user)
}

// List 获取用户列表
//
//	@Tags			User
//	@Summary		获取用户列表
//	@Description	获取用户列表
//	@ID				list-user
//	@Accept			json
//	@Produce		json
//	@Param			page	query		web.Pagination	true	"分页"
//	@Success		200		{object}	web.Resp{data=domain.ListUserResp}
//	@Router			/api/v1/user/list [get]
func (h *UserHandler) List(c *web.Context, req domain.ListReq) error {
	resp, err := h.usecase.List(c.Request().Context(), req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// LoginHistory 获取用户登录历史
//
//	@Tags			User
//	@Summary		获取用户登录历史
//	@Description	获取用户登录历史
//	@ID				login-history
//	@Accept			json
//	@Produce		json
//	@Param			page	query		web.Pagination	true	"分页"
//	@Success		200		{object}	web.Resp{data=domain.ListLoginHistoryResp}
//	@Router			/api/v1/user/login-history [get]
func (h *UserHandler) LoginHistory(c *web.Context) error {
	resp, err := h.usecase.LoginHistory(c.Request().Context(), c.Page())
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Invite 获取用户邀请码
//
//	@Tags			User
//	@Summary		获取用户邀请码
//	@Description	获取用户邀请码
//	@ID				invite
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.InviteResp}
//	@Router			/api/v1/user/invite [get]
func (h *UserHandler) Invite(c *web.Context) error {
	admin := middleware.GetAdmin(c)

	edition := c.Get("edition")
	if edition == nil {
		return errcode.ErrPermission
	}

	// 如果是 Free 版本 user 表不允许超过 100 人
	if edition.(int) == 0 {
		count, err := h.usecase.GetUserCount(c.Request().Context())
		if err != nil {
			return err
		}
		if count >= 100 {
			return errcode.ErrUserLimit
		}
	}

	resp, err := h.usecase.Invite(c.Request().Context(), admin.ID.String())
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Register 注册用户
//
//	@Tags			User
//	@Summary		注册用户
//	@Description	注册用户
//	@ID				register
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.RegisterReq	true	"注册参数"
//	@Success		200		{object}	web.Resp{data=domain.User}
//	@Router			/api/v1/user/register [post]
func (h *UserHandler) Register(c *web.Context, req domain.RegisterReq) error {
	resp, err := h.usecase.Register(c.Request().Context(), &req)
	if err != nil {
		return err
	}

	return c.Success(resp)
}

// CreateAdmin 创建管理员
//
//	@Tags			Admin
//	@Summary		创建管理员
//	@Description	创建管理员
//	@ID				create-admin
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.CreateAdminReq	true	"创建管理员参数"
//	@Success		200		{object}	web.Resp{data=domain.AdminUser}
//	@Router			/api/v1/admin/create [post]
func (h *UserHandler) CreateAdmin(c *web.Context, req domain.CreateAdminReq) error {
	user := middleware.GetAdmin(c)
	if user.Username != "admin" {
		return errcode.ErrPermission
	}
	resp, err := h.usecase.CreateAdmin(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// AdminList 获取管理员用户列表
//
//	@Tags			Admin
//	@Summary		获取管理员用户列表
//	@Description	获取管理员用户列表
//	@ID				list-admin-user
//	@Accept			json
//	@Produce		json
//	@Param			page	query		web.Pagination	true	"分页"
//	@Success		200		{object}	web.Resp{data=domain.ListAdminUserResp}
//	@Router			/api/v1/admin/list [get]
func (h *UserHandler) AdminList(c *web.Context) error {
	resp, err := h.usecase.AdminList(c.Request().Context(), c.Page())
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// AdminLoginHistory 获取管理员登录历史
//
//	@Tags			Admin
//	@Summary		获取管理员登录历史
//	@Description	获取管理员登录历史
//	@ID				admin-login-history
//	@Accept			json
//	@Produce		json
//	@Param			page	query		web.Pagination	true	"分页"
//	@Success		200		{object}	web.Resp{data=domain.ListAdminLoginHistoryResp}
//	@Router			/api/v1/admin/login-history [get]
func (h *UserHandler) AdminLoginHistory(c *web.Context) error {
	resp, err := h.usecase.AdminLoginHistory(c.Request().Context(), c.Page())
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListRole 获取系统角色列表
//
//	@Tags			Admin
//	@Summary		获取角色列表
//	@Description	获取角色列表
//	@ID				list-role
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=[]domain.Role}
//	@Router			/api/v1/admin/role [get]
func (h *UserHandler) ListRole(c *web.Context) error {
	roles, err := h.usecase.ListRole(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(roles)
}

// GrantRole 授权角色
//
//	@Tags			Admin
//	@Summary		授权角色
//	@Description	授权角色
//	@ID				grant-role
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.GrantRoleReq	true	"授权角色参数"
//	@Success		200		{object}	web.Resp
//	@Router			/api/v1/admin/role [post]
func (h *UserHandler) GrantRole(c *web.Context, req domain.GrantRoleReq) error {
	if err := h.usecase.GrantRole(c.Request().Context(), &req); err != nil {
		return err
	}
	return c.Success(nil)
}

// GetSetting 获取系统设置
//
//	@Tags			Admin
//	@Summary		获取系统设置
//	@Description	获取系统设置
//	@ID				get-setting
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.Setting}
//	@Router			/api/v1/admin/setting [get]
func (h *UserHandler) GetSetting(c *web.Context) error {
	resp, err := h.usecase.GetSetting(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// UpdateSetting 更新系统设置
//
//	@Tags			Admin
//	@Summary		更新系统设置
//	@Description	更新为增量更新，只传需要更新的字段
//	@ID				update-setting
//	@Accept			json
//	@Produce		json
//	@Param			param	body		domain.UpdateSettingReq	true	"更新系统设置参数"
//	@Success		200		{object}	web.Resp{data=domain.Setting}
//	@Router			/api/v1/admin/setting [put]
func (h *UserHandler) UpdateSetting(c *web.Context, req domain.UpdateSettingReq) error {
	resp, err := h.usecase.UpdateSetting(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// OAuthSignUpOrIn 用户 OAuth 登录或注册
//
//	@Tags			User
//	@Summary		用户 OAuth 登录或注册
//	@Description	用户 OAuth 登录或注册
//	@ID				user-oauth-signup-or-in
//	@Accept			json
//	@Produce		json
//	@Param			req	query		domain.OAuthSignUpOrInReq	true	"param"
//	@Success		200	{object}	web.Resp{data=domain.OAuthURLResp}
//	@Router			/api/v1/user/oauth/signup-or-in [get]
func (h *UserHandler) OAuthSignUpOrIn(ctx *web.Context, req domain.OAuthSignUpOrInReq) error {
	h.logger.With("req", req).DebugContext(ctx.Request().Context(), "OAuthSignUpOrIn")
	s, err := h.usecase.GetSetting(ctx.Request().Context())
	if err != nil {
		return err
	}
	req.BaseURL = h.cfg.GetBaseURL(ctx.Request(), s)
	resp, err := h.usecase.OAuthSignUpOrIn(ctx.Request().Context(), &req)
	if err != nil {
		return err
	}
	return ctx.Success(resp)
}

// OAuthCallback 用户 OAuth 回调
//
//	@Tags			User
//	@Summary		用户 OAuth 回调
//	@Description	用户 OAuth 回调
//	@ID				user-oauth-callback
//	@Accept			json
//	@Produce		json
//	@Param			req	query		domain.OAuthCallbackReq	true	"param"
//	@Success		200	{object}	web.Resp{data=string}
//	@Router			/api/v1/user/oauth/callback [get]
func (h *UserHandler) OAuthCallback(ctx *web.Context, req domain.OAuthCallbackReq) error {
	return h.usecase.OAuthCallback(ctx, &req)
}

// Profile 获取用户信息
//
//	@Tags			User Manage
//	@Summary		获取用户信息
//	@Description	获取用户信息
//	@ID				user-profile
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.User}
//	@Failure		401	{object}	web.Resp{}
//	@Router			/api/v1/user/profile [get]
func (h *UserHandler) Profile(ctx *web.Context) error {
	return ctx.Success(middleware.GetUser(ctx))
}

// UpdateProfile 更新用户信息
//
//	@Tags			User Manage
//	@Summary		更新用户信息
//	@Description	更新用户信息
//	@ID				user-update-profile
//	@Accept			json
//	@Produce		json
//	@Param			req	body		domain.ProfileUpdateReq	true	"param"
//	@Success		200	{object}	web.Resp{data=domain.User}
//	@Failure		401	{object}	web.Resp{}
//	@Router			/api/v1/user/profile [put]
func (h *UserHandler) UpdateProfile(ctx *web.Context, req domain.ProfileUpdateReq) error {
	req.UID = middleware.GetUser(ctx).ID
	user, err := h.usecase.ProfileUpdate(ctx.Request().Context(), &req)
	if err != nil {
		return err
	}
	return ctx.Success(user)
}

func (h *UserHandler) InitAdmin() error {
	return h.usecase.InitAdmin(context.Background())
}

// ExportCompletionData godoc
//
//	@Summary		导出补全数据
//	@Description	管理员导出所有补全相关数据
//	@Tags			admin
//	@Accept			json
//	@Produce		json
//	@Security		ApiKeyAuth
//	@Success		200	{object}	domain.ExportCompletionDataResp
//	@Failure		401	{object}	web.Resp{}
//	@Failure		500	{object}	web.Resp{}
//	@Router			/api/v1/admin/export-completion-data [get]
func (h *UserHandler) ExportCompletionData(c *web.Context) error {
	data, err := h.usecase.ExportCompletionData(c.Request().Context())
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, data)
}
