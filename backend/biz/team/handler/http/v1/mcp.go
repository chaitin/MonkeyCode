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

type TeamMCPHandler struct {
	usecase domain.TeamMCPUsecase
}

func NewTeamMCPHandler(i *do.Injector) (*TeamMCPHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)
	repo := do.MustInvoke[domain.TeamMCPRepo](i)

	h := &TeamMCPHandler{usecase: do.MustInvoke[domain.TeamMCPUsecase](i)}
	adminAuth := middleware.TeamAdminAuth(func(ctx context.Context, teamID, userID uuid.UUID) bool {
		member, err := repo.GetMember(ctx, teamID, userID)
		return err == nil && member.TeamRole == consts.TeamMemberRoleAdmin
	})

	g := w.Group("/api/v1/teams/mcp")
	g.Use(auth.TeamAuth())
	g.GET("/upstreams", web.BaseHandler(h.ListUpstreams))
	g.POST("/upstreams", web.BindHandler(h.CreateUpstream), adminAuth, audit.Audit("create_team_mcp_upstream"))
	g.PUT("/upstreams/:upstream_id", web.BindHandler(h.UpdateUpstream), adminAuth, audit.Audit("update_team_mcp_upstream"))
	g.DELETE("/upstreams/:upstream_id", web.BindHandler(h.DeleteUpstream), adminAuth, audit.Audit("delete_team_mcp_upstream"))
	g.POST("/upstreams/:upstream_id/sync", web.BindHandler(h.SyncUpstream), adminAuth, audit.Audit("sync_team_mcp_upstream"))
	return h, nil
}

// ListUpstreams 获取团队 MCP Upstream 列表
//
//	@Summary	获取团队 MCP Upstream 列表
//	@Tags		【Team 管理员】MCP 配置
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Success	200	{object}	web.Resp{data=domain.ListTeamMCPUpstreamsResp}	"成功"
//	@Router		/api/v1/teams/mcp/upstreams [get]
func (h *TeamMCPHandler) ListUpstreams(c *web.Context) error {
	resp, err := h.usecase.ListUpstreams(c.Request().Context(), middleware.GetTeamUser(c))
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// CreateUpstream 创建团队 MCP Upstream
//
//	@Summary	创建团队 MCP Upstream
//	@Tags		【Team 管理员】MCP 配置
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		req	body		domain.CreateTeamMCPUpstreamReq			true	"请求参数"
//	@Success	200	{object}	web.Resp{data=domain.TeamMCPUpstream}	"成功"
//	@Router		/api/v1/teams/mcp/upstreams [post]
func (h *TeamMCPHandler) CreateUpstream(c *web.Context, req domain.CreateTeamMCPUpstreamReq) error {
	resp, err := h.usecase.CreateUpstream(c.Request().Context(), middleware.GetTeamUser(c), req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// UpdateUpstream 更新团队 MCP Upstream
//
//	@Summary	更新团队 MCP Upstream
//	@Tags		【Team 管理员】MCP 配置
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		upstream_id	path		string									true	"MCP Upstream ID"
//	@Param		req			body		domain.UpdateTeamMCPUpstreamReq			true	"请求参数"
//	@Success	200			{object}	web.Resp{data=domain.TeamMCPUpstream}	"成功"
//	@Router		/api/v1/teams/mcp/upstreams/{upstream_id} [put]
func (h *TeamMCPHandler) UpdateUpstream(c *web.Context, req domain.UpdateTeamMCPUpstreamReq) error {
	resp, err := h.usecase.UpdateUpstream(c.Request().Context(), middleware.GetTeamUser(c), req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// DeleteUpstream 删除团队 MCP Upstream
//
//	@Summary	删除团队 MCP Upstream
//	@Tags		【Team 管理员】MCP 配置
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		upstream_id	path		string		true	"MCP Upstream ID"
//	@Success	200			{object}	web.Resp{}	"成功"
//	@Router		/api/v1/teams/mcp/upstreams/{upstream_id} [delete]
func (h *TeamMCPHandler) DeleteUpstream(c *web.Context, req domain.DeleteTeamMCPUpstreamReq) error {
	if err := h.usecase.DeleteUpstream(c.Request().Context(), middleware.GetTeamUser(c), req); err != nil {
		return err
	}
	return c.Success(nil)
}

// SyncUpstream 同步团队 MCP Upstream
//
//	@Summary	同步团队 MCP Upstream
//	@Tags		【Team 管理员】MCP 配置
//	@Accept		json
//	@Produce	json
//	@Security	MonkeyCodeAITeamAuth
//	@Param		upstream_id	path		string		true	"MCP Upstream ID"
//	@Success	200			{object}	web.Resp{}	"成功"
//	@Router		/api/v1/teams/mcp/upstreams/{upstream_id}/sync [post]
func (h *TeamMCPHandler) SyncUpstream(c *web.Context, req domain.SyncTeamMCPUpstreamReq) error {
	if err := h.usecase.SyncUpstream(c.Request().Context(), middleware.GetTeamUser(c), req); err != nil {
		return err
	}
	return c.Success(nil)
}
