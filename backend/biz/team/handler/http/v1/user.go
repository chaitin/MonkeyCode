package v1

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
)

// TeamGroupUserHandler 团队分组用户处理器
type TeamGroupUserHandler struct {
	usecase         domain.TeamGroupUserUsecase
	repo            domain.TeamGroupUserRepo
	config          *config.Config
	authMiddleware  *middleware.AuthMiddleware
	auditMiddleware *middleware.AuditMiddleware
	logger          *slog.Logger
	captcha         *captcha.Captcha
}

// NewTeamGroupUserHandler 创建团队分组用户处理器 (samber/do 风格)
func NewTeamGroupUserHandler(i *do.Injector) (*TeamGroupUserHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	usecase := do.MustInvoke[domain.TeamGroupUserUsecase](i)
	repo := do.MustInvoke[domain.TeamGroupUserRepo](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)
	cfg := do.MustInvoke[*config.Config](i)
	logger := do.MustInvoke[*slog.Logger](i)
	captchaSvc := do.MustInvoke[*captcha.Captcha](i)

	h := &TeamGroupUserHandler{
		usecase:         usecase,
		repo:            repo,
		config:          cfg,
		authMiddleware:  auth,
		auditMiddleware: audit,
		logger:          logger.With("module", "handler.team_group_user"),
		captcha:         captchaSvc,
	}

	adminAuth := middleware.TeamAdminAuth(func(ctx context.Context, teamID, userID uuid.UUID) bool {
		member, err := repo.GetMember(ctx, teamID, userID)
		if err != nil {
			return false
		}
		return member.Role == consts.TeamMemberRoleAdmin
	})

	a := w.Group("/api/v1/teams/admin")
	a.POST("", web.BindHandler(h.AddAdmin), auth.TeamAuth(), adminAuth, audit.Audit("add_team_admin"))

	u := w.Group("/api/v1/teams/users")
	u.POST("/login", web.BindHandler(h.Login), audit.Audit("team_user_login"))
	u.POST("/logout", web.BaseHandler(h.Logout), auth.TeamAuthCheck())
	u.GET("/status", web.BaseHandler(h.Status), auth.TeamAuthCheck())
	u.PUT("/passwords/change", web.BindHandler(h.ChangePassword), auth.TeamAuth(), audit.Audit("change_team_user_password"))
	u.POST("", web.BindHandler(h.AddUser), auth.TeamAuth(), adminAuth, audit.Audit("add_team_user"))
	u.GET("", web.BindHandler(h.MemberList), auth.TeamAuth(), adminAuth)
	u.PUT("/:user_id", web.BindHandler(h.UpdateUser), auth.TeamAuth(), adminAuth, audit.Audit("update_team_user"))

	g := w.Group("/api/v1/teams/groups")
	g.GET("", web.BaseHandler(h.List), auth.TeamAuth())
	g.POST("", web.BindHandler(h.Add), auth.TeamAuth(), adminAuth, audit.Audit("add_team_group"))
	g.PUT("/:group_id", web.BindHandler(h.Update), auth.TeamAuth(), adminAuth, audit.Audit("update_team_group"))
	g.DELETE("/:group_id", web.BaseHandler(h.Delete), auth.TeamAuth(), adminAuth, audit.Audit("delete_team_group"))

	gu := w.Group("/api/v1/teams/groups/:group_id/users")
	gu.Use(auth.TeamAuth())
	gu.GET("", web.BindHandler(h.ListGroupUsers))
	gu.PUT("", web.BindHandler(h.ModifyGroupUsers), adminAuth, audit.Audit("modify_team_group_users"))

	return h, nil
}

// Login 登录
func (h *TeamGroupUserHandler) Login(c *web.Context, req *domain.TeamLoginReq) error {
	ctx := c.Request().Context()

	// 验证验证码
	if req.CaptchaToken != "" {
		ok, err := h.captcha.Verify(req.CaptchaToken, nil)
		if err != nil || !ok {
			h.logger.WarnContext(ctx, "captcha verification failed", "error", err)
			return errcode.ErrCaptchaVerifyFailed
		}
	}

	user, err := h.usecase.Login(ctx, req)
	if err != nil {
		h.logger.WarnContext(ctx, "team login failed", "email", req.Email, "error", err)
		return errcode.ErrLoginFailed
	}

	// 生成 Cookie
	cookie, err := h.authMiddleware.GenerateCookieByUID(ctx, user.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "generate cookie failed", "error", err)
		return errcode.ErrInternalServer
	}

	// 保存到 Redis
	err = h.authMiddleware.SetUserCookieIntoRedis(ctx, cookie, middleware.TeamUserSessionKey, &domain.User{
		ID:    user.ID,
		Name:  user.Name,
		Email: user.Email,
	})
	if err != nil {
		h.logger.ErrorContext(ctx, "set user cookie into redis failed", "error", err)
		return errcode.ErrInternalServer
	}

	// 设置 Cookie
	h.setCookie(c, cookie)

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"message": "login success",
	})
}

// Logout 登出
func (h *TeamGroupUserHandler) Logout(c *web.Context) error {
	ctx := c.Request().Context()

	user := middleware.GetTeamUser(c)
	if user == nil || user.User == nil {
		return errcode.ErrUnauthorized
	}

	cookie, err := c.Cookie(consts.MonkeyCodeAITeamSession)
	if err == nil && cookie.Value != "" {
		err = h.authMiddleware.DeleteUserCookieFromRedis(ctx, middleware.TeamUserSessionKey, user.User.ID)
		if err != nil {
			h.logger.ErrorContext(ctx, "delete user cookie from redis failed", "error", err)
		}
	}

	h.clearCookie(c)

	return c.JSON(http.StatusOK, map[string]string{"message": "logout success"})
}

// Status 获取状态
func (h *TeamGroupUserHandler) Status(c *web.Context) error {
	user := middleware.GetTeamUser(c)
	if user == nil || user.User == nil {
		return c.JSON(http.StatusOK, map[string]bool{"login": false})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"login":    true,
		"teamUser": user,
	})
}

// ChangePassword 修改密码
func (h *TeamGroupUserHandler) ChangePassword(c *web.Context, req *domain.ChangePasswordReq) error {
	ctx := c.Request().Context()

	user := middleware.GetTeamUser(c)
	if user == nil || user.User == nil {
		return errcode.ErrUnauthorized
	}

	err := h.usecase.ChangePassword(ctx, user.User.ID, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "change password failed", "error", err)
		return errcode.ErrChangePasswordFailed
	}

	return c.JSON(http.StatusOK, map[string]bool{"success": true})
}

// AddUser 添加用户
func (h *TeamGroupUserHandler) AddUser(c *web.Context, req *domain.AddTeamUserReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	resp, err := h.usecase.AddUser(ctx, teamUser, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "add user failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// AddAdmin 添加管理员
func (h *TeamGroupUserHandler) AddAdmin(c *web.Context, req *domain.AddTeamAdminReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	resp, err := h.usecase.AddAdmin(ctx, teamUser, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "add admin failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// MemberList 成员列表
func (h *TeamGroupUserHandler) MemberList(c *web.Context, req *domain.MemberListReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	resp, err := h.usecase.MemberList(ctx, teamUser, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "member list failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// UpdateUser 更新用户
func (h *TeamGroupUserHandler) UpdateUser(c *web.Context, req *domain.UpdateTeamUserReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	req.UserID = uuid.MustParse(c.Param("user_id"))

	resp, err := h.usecase.UpdateUser(ctx, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "update user failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// List 分组列表
func (h *TeamGroupUserHandler) List(c *web.Context) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	resp, err := h.usecase.List(ctx, teamUser)
	if err != nil {
		h.logger.ErrorContext(ctx, "list groups failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// Add 添加分组
func (h *TeamGroupUserHandler) Add(c *web.Context, req *domain.AddTeamGroupReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	resp, err := h.usecase.Add(ctx, teamUser, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "add group failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// Update 更新分组
func (h *TeamGroupUserHandler) Update(c *web.Context, req *domain.UpdateTeamGroupReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	req.GroupID = uuid.MustParse(c.Param("group_id"))

	resp, err := h.usecase.Update(ctx, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "update group failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// Delete 删除分组
func (h *TeamGroupUserHandler) Delete(c *web.Context) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	groupID := uuid.MustParse(c.Param("group_id"))

	err := h.usecase.Delete(ctx, teamUser, &domain.DeleteTeamGroupReq{GroupID: groupID})
	if err != nil {
		h.logger.ErrorContext(ctx, "delete group failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, map[string]bool{"success": true})
}

// ListGroupUsers 组成员列表
func (h *TeamGroupUserHandler) ListGroupUsers(c *web.Context, req *domain.ListTeamGroupUsersReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	req.GroupID = uuid.MustParse(c.Param("group_id"))

	resp, err := h.usecase.ListGroups(ctx, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "list group users failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

// ModifyGroupUsers 修改组成员
func (h *TeamGroupUserHandler) ModifyGroupUsers(c *web.Context, req *domain.AddTeamGroupUsersReq) error {
	ctx := c.Request().Context()

	teamUser := middleware.GetTeamUser(c)
	if teamUser == nil {
		return errcode.ErrUnauthorized
	}

	req.GroupID = uuid.MustParse(c.Param("group_id"))

	resp, err := h.usecase.ModifyGroups(ctx, req)
	if err != nil {
		h.logger.ErrorContext(ctx, "modify group users failed", "error", err)
		return err
	}

	return c.JSON(http.StatusOK, resp)
}

func (h *TeamGroupUserHandler) setCookie(c *web.Context, cookie string) {
	c.SetCookie(&http.Cookie{
		Name:     consts.MonkeyCodeAITeamSession,
		Value:    cookie,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   h.config.Session.Expire,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *TeamGroupUserHandler) clearCookie(c *web.Context) {
	c.SetCookie(&http.Cookie{
		Name:     consts.MonkeyCodeAITeamSession,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}
