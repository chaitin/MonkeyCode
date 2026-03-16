package v1

import (
	"context"
	"log/slog"

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
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)
	logger := do.MustInvoke[*slog.Logger](i)

	h := &TeamGroupUserHandler{
		usecase:         do.MustInvoke[domain.TeamGroupUserUsecase](i),
		repo:            do.MustInvoke[domain.TeamGroupUserRepo](i),
		config:          do.MustInvoke[*config.Config](i),
		authMiddleware:  auth,
		auditMiddleware: audit,
		logger:          logger.With("module", "handler.team_group_user"),
		captcha:         do.MustInvoke[*captcha.Captcha](i),
	}

	adminAuth := middleware.TeamAdminAuth(func(ctx context.Context, teamID, userID uuid.UUID) bool {
		member, err := h.repo.GetMember(ctx, teamID, userID)
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
	g.DELETE("/:group_id", web.BindHandler(h.Delete), auth.TeamAuth(), adminAuth, audit.Audit("delete_team_group"))

	gu := w.Group("/api/v1/teams/groups/:group_id/users")
	gu.Use(auth.TeamAuth())
	gu.GET("", web.BindHandler(h.ListGroupUsers))
	gu.PUT("", web.BindHandler(h.ModifyGroupUsers), adminAuth, audit.Audit("modify_team_group_users"))

	return h, nil
}

// Login 团队用户登录
//
//	@Summary		团队用户登录
//	@Description	团队用户登录，password 字段需要传 MD5 加密后的值
//	@Tags			【Team 管理员】认证
//	@Accept			json
//	@Produce		json
//	@Param			req	body		domain.TeamLoginReq				true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.TeamUser}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/users/login [post]
func (h *TeamGroupUserHandler) Login(c *web.Context, req domain.TeamLoginReq) error {
	ctx := c.Request().Context()
	if !h.captcha.ValidateToken(ctx, req.CaptchaToken) {
		return errcode.ErrForbidden
	}

	user, err := h.usecase.Login(ctx, &req)
	if err != nil {
		h.logger.WarnContext(ctx, "team login failed", "email", req.Email, "error", err)
		return errcode.ErrLoginFailed
	}

	// 创建 session（内部生成 cookie 并设置到 response）
	_, err = h.authMiddleware.Session.Save(c, consts.MonkeyCodeAITeamSession, user.ID, user)
	if err != nil {
		h.logger.ErrorContext(ctx, "save session failed", "error", err)
		return errcode.ErrInternalServer
	}

	return c.Success(user)
}

// Logout 团队用户登出
//
//	@Summary		团队用户登出
//	@Description	团队用户登出
//	@Tags			【Team 管理员】认证
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/users/logout [post]
func (h *TeamGroupUserHandler) Logout(c *web.Context) error {
	ctx := c.Request().Context()

	user := middleware.GetTeamUser(c)
	if user == nil || user.User == nil {
		return errcode.ErrUnauthorized
	}

	err := h.authMiddleware.Session.Del(c, consts.MonkeyCodeAITeamSession, user.User.ID)
	if err != nil {
		h.logger.ErrorContext(ctx, "delete session failed", "error", err)
	}

	return c.Success(nil)
}

// Status 获取团队用户登录状态
//
//	@Summary		获取团队用户登录状态
//	@Description	获取团队用户登录状态
//	@Tags			【Team 管理员】认证
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.TeamUser}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/users/status [get]
func (h *TeamGroupUserHandler) Status(c *web.Context) error {
	user := middleware.GetTeamUser(c)
	if user == nil {
		return errcode.ErrNotLoggedIn
	}
	return c.Success(user)
}

// ChangePassword 修改密码接口
//
//	@Summary		修改密码
//	@Description	修改当前用户的密码
//	@Tags			【Team 管理员】认证
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.ChangePasswordReq	true	"修改密码请求"
//	@Success		200	{object}	web.Resp{}					"成功"
//	@Router			/api/v1/teams/users/passwords/change [put]
func (h *TeamGroupUserHandler) ChangePassword(c *web.Context, req domain.ChangePasswordReq) error {
	teamUser := middleware.GetTeamUser(c)
	err := h.usecase.ChangePassword(c.Request().Context(), teamUser.User.ID, &req)
	if err != nil {
		return err
	}
	if err := h.Logout(c); err != nil {
		return err
	}
	return c.Success(nil)
}

// AddUser 创建团队成员
//
//	@Summary		创建团队成员
//	@Description	创建团队成员，发送重置密码邮件
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.AddTeamUserReq					true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.AddTeamUserResp}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/users [post]
func (h *TeamGroupUserHandler) AddUser(c *web.Context, req domain.AddTeamUserReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.AddUser(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// AddAdmin 创建团队管理员
//
//	@Summary		创建团队管理员
//	@Description	创建团队管理员，将用户添加到团队并设置为管理员角色
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.AddTeamAdminReq					true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.AddTeamAdminResp}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/admin [post]
func (h *TeamGroupUserHandler) AddAdmin(c *web.Context, req domain.AddTeamAdminReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.AddAdmin(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// MemberList 获取团队成员列表
//
//	@Summary		获取团队成员列表
//	@Description	获取团队成员列表，支持按角色筛选
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			role	query		string									false	"团队成员角色筛选（可选值：admin, user）"
//	@Success		200		{object}	web.Resp{data=domain.MemberListResp}	"成功"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Failure		500		{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/users [get]
func (h *TeamGroupUserHandler) MemberList(c *web.Context, req domain.MemberListReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.MemberList(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// MemberList 获取团队成员列表
//
//	@Summary		获取团队成员列表
//	@Description	获取团队成员列表，支持按角色筛选
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			role	query		string									false	"团队成员角色筛选（可选值：admin, user）"
//	@Success		200		{object}	web.Resp{data=domain.MemberListResp}	"成功"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Failure		500		{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/users [get]
func (h *TeamGroupUserHandler) UpdateUser(c *web.Context, req domain.UpdateTeamUserReq) error {
	resp, err := h.usecase.UpdateUser(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	// 如果设置了禁用用户，删除该用户相关联的 cookie
	if *req.IsBlocked {
		err := h.authMiddleware.Session.Trunc(c.Request().Context(), consts.MonkeyCodeAITeamSession, resp.User.ID)
		if err != nil {
			return err
		}
	}
	return c.Success(resp)
}

// List 获取团队分组列表
//
//	@Summary		获取团队分组列表
//	@Description	获取团队分组列表
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Success		200	{object}	web.Resp{data=domain.ListTeamGroupsResp}	"成功"
//	@Failure		401	{object}	web.Resp									"未授权"
//	@Failure		500	{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/teams/groups [get]
func (h *TeamGroupUserHandler) List(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.List(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Add 创建团队分组
//
//	@Summary		创建团队分组
//	@Description	创建团队分组
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.AddTeamGroupReq			true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.TeamGroup}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/groups [post]
func (h *TeamGroupUserHandler) Add(c *web.Context, req domain.AddTeamGroupReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Add(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 更新团队分组
//
//	@Summary		更新团队分组
//	@Description	更新团队分组
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			group_id	path		string							true	"团队组ID"
//	@Param			req			body		domain.UpdateTeamGroupReq		true	"请求参数"
//	@Success		200			{object}	web.Resp{data=domain.TeamGroup}	"成功"
//	@Failure		401			{object}	web.Resp						"未授权"
//	@Failure		500			{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/groups/{group_id} [put]
func (h *TeamGroupUserHandler) Update(c *web.Context, req domain.UpdateTeamGroupReq) error {
	resp, err := h.usecase.Update(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除团队分组
//
//	@Summary		删除团队分组
//	@Description	删除团队分组
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			group_id	path		string		true	"团队组ID"
//	@Success		200			{object}	web.Resp{}	"成功"
//	@Failure		401			{object}	web.Resp	"未授权"
//	@Failure		500			{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/groups/{group_id} [delete]
func (h *TeamGroupUserHandler) Delete(c *web.Context, req domain.DeleteTeamGroupReq) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.usecase.Delete(c.Request().Context(), teamUser, &req); err != nil {
		return err
	}
	return c.Success(nil)
}

// ListGroupUsers 组成员列表
func (h *TeamGroupUserHandler) ListGroupUsers(c *web.Context, req domain.ListTeamGroupUsersReq) error {
	resp, err := h.usecase.ListGroups(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ModifyGroupUsers 修改团队组成员
//
//	@Summary		修改团队组成员
//	@Description	修改团队组成员
//	@Tags			【Team 管理员】分组成员管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			group_id	path		string										true	"团队组ID"
//	@Param			req			body		domain.AddTeamGroupUsersReq					true	"请求参数"
//	@Success		200			{object}	web.Resp{data=domain.AddTeamGroupUsersResp}	"成功"
//	@Failure		401			{object}	web.Resp									"未授权"
//	@Failure		500			{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/teams/groups/{group_id}/users [put]
func (h *TeamGroupUserHandler) ModifyGroupUsers(c *web.Context, req domain.AddTeamGroupUsersReq) error {
	resp, err := h.usecase.ModifyGroups(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
