package v1

import (
	"context"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type TeamRuleHandler struct {
	usecase domain.TeamRuleUsecase
	repo    domain.TeamGroupUserRepo
}

func NewTeamRuleHandler(i *do.Injector) (*TeamRuleHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)

	h := &TeamRuleHandler{
		usecase: do.MustInvoke[domain.TeamRuleUsecase](i),
		repo:    do.MustInvoke[domain.TeamGroupUserRepo](i),
	}

	adminAuth := middleware.TeamAdminAuth(func(ctx context.Context, teamID, userID uuid.UUID) bool {
		member, err := h.repo.GetMember(ctx, teamID, userID)
		if err != nil {
			return false
		}
		return member.Role == consts.TeamMemberRoleAdmin
	})

	g := w.Group("/api/v1/teams/rules")
	g.Use(auth.TeamAuth(), adminAuth)
	g.GET("", web.BaseHandler(h.List))
	g.POST("", web.BindHandler(h.Add), audit.Audit("add_team_rule"))
	g.PUT("/:rule_id", web.BindHandler(h.Update), audit.Audit("update_team_rule"))
	g.PUT("/:rule_id/enabled", web.BindHandler(h.SetEnabled), audit.Audit("enable_team_rule"))
	g.DELETE("/:rule_id", web.BindHandler(h.Delete), audit.Audit("delete_team_rule"))
	g.GET("/:rule_id/versions", web.BindHandler(h.ListVersions))
	g.POST("/:rule_id/restore", web.BindHandler(h.Restore), audit.Audit("restore_team_rule"))
	return h, nil
}

// List 企业级全局规范列表
//
//	@Summary	获取企业级全局规范列表
//	@Tags		【Team 管理员】全局规范
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Success	200	{object}	web.Resp{data=domain.ListTeamRulesResp}	"成功"
//	@Router		/api/v1/teams/rules [get]
func (h *TeamRuleHandler) List(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.List(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Add 新建企业级全局规范
//
//	@Summary	新建企业级全局规范
//	@Tags		【Team 管理员】全局规范
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		req	body		domain.AddTeamRuleReq			true	"请求参数"
//	@Success	200	{object}	web.Resp{data=domain.TeamRule}	"成功"
//	@Router		/api/v1/teams/rules [post]
func (h *TeamRuleHandler) Add(c *web.Context, req domain.AddTeamRuleReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Add(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 编辑企业级全局规范
//
//	@Summary	编辑企业级全局规范
//	@Tags		【Team 管理员】全局规范
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		rule_id	path		string							true	"规范 ID"
//	@Param		req		body		domain.UpdateTeamRuleReq		true	"请求参数"
//	@Success	200		{object}	web.Resp{data=domain.TeamRule}	"成功"
//	@Router		/api/v1/teams/rules/{rule_id} [put]
func (h *TeamRuleHandler) Update(c *web.Context, req domain.UpdateTeamRuleReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// SetEnabled 启用或禁用企业级全局规范
//
//	@Summary	启用或禁用企业级全局规范
//	@Tags		【Team 管理员】全局规范
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		rule_id	path		string							true	"规范 ID"
//	@Param		req		body		domain.SetTeamRuleEnabledReq	true	"请求参数"
//	@Success	200		{object}	web.Resp{data=domain.TeamRule}	"成功"
//	@Router		/api/v1/teams/rules/{rule_id}/enabled [put]
func (h *TeamRuleHandler) SetEnabled(c *web.Context, req domain.SetTeamRuleEnabledReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.SetEnabled(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 软删除企业级全局规范
//
//	@Summary	软删除企业级全局规范
//	@Tags		【Team 管理员】全局规范
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		rule_id	path		string		true	"规范 ID"
//	@Success	200		{object}	web.Resp	"成功"
//	@Router		/api/v1/teams/rules/{rule_id} [delete]
func (h *TeamRuleHandler) Delete(c *web.Context, req domain.DeleteTeamRuleReq) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.usecase.Delete(c.Request().Context(), teamUser, &req); err != nil {
		return err
	}
	return c.Success(nil)
}

// ListVersions 查看规范历史版本
//
//	@Summary	查看规范历史版本
//	@Tags		【Team 管理员】全局规范
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		rule_id	path		string									true	"规范 ID"
//	@Success	200		{object}	web.Resp{data=domain.ListTeamRuleVersionsResp}	"成功"
//	@Router		/api/v1/teams/rules/{rule_id}/versions [get]
func (h *TeamRuleHandler) ListVersions(c *web.Context, req domain.ListTeamRuleVersionsReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.ListVersions(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Restore 恢复历史版本为活动版本
//
//	@Summary	恢复历史版本
//	@Tags		【Team 管理员】全局规范
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		rule_id	path		string							true	"规范 ID"
//	@Param		req		body		domain.RestoreTeamRuleReq		true	"请求参数"
//	@Success	200		{object}	web.Resp{data=domain.TeamRule}	"成功"
//	@Router		/api/v1/teams/rules/{rule_id}/restore [post]
func (h *TeamRuleHandler) Restore(c *web.Context, req domain.RestoreTeamRuleReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Restore(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
