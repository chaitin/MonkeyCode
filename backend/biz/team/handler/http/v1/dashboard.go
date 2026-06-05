package v1

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type TeamDashboardHandler struct {
	usecase domain.TeamDashboardUsecase
}

func NewTeamDashboardHandler(i *do.Injector) (*TeamDashboardHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &TeamDashboardHandler{
		usecase: do.MustInvoke[domain.TeamDashboardUsecase](i),
	}

	g := w.Group("/api/v1/teams/dashboard")
	g.Use(auth.TeamAuth())
	g.GET("", web.BindHandler(h.Overview))
	teams := w.Group("/api/v1/teams")
	teams.Use(auth.TeamAuth())
	teams.GET("/projects", web.BindHandler(h.ListProjects))
	teams.GET("/tasks", web.BindHandler(h.ListTasks))
	teams.GET("/conversations", web.BindHandler(h.ListConversations))

	return h, nil
}

// Overview 获取团队管理概览
//
//	@Summary		获取团队管理概览
//	@Description	获取团队活跃、任务、耗时、Token 消耗趋势和洞察列表
//	@Tags			【Team 管理员】团队概览
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			range	query		string									false	"时间范围：today、7d、30d"
//	@Success		200		{object}	web.Resp{data=domain.TeamDashboardResp}	"成功"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Failure		500		{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/dashboard [get]
func (h *TeamDashboardHandler) Overview(c *web.Context, req domain.TeamDashboardReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Overview(c.Request().Context(), teamUser, req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListProjects 获取团队项目列表
//
//	@Summary		获取团队项目列表
//	@Description	获取当前团队成员创建的项目列表
//	@Tags			【Team 管理员】团队项目
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			cursor	query		string										false	"分页游标"
//	@Param			limit	query		int											false	"每页数量"
//	@Success		200		{object}	web.Resp{data=domain.TeamProjectListResp}	"成功"
//	@Router			/api/v1/teams/projects [get]
func (h *TeamDashboardHandler) ListProjects(c *web.Context, req domain.TeamDashboardListReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.ListProjects(c.Request().Context(), teamUser, req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListTasks 获取团队任务列表
//
//	@Summary		获取团队任务列表
//	@Description	获取当前团队成员创建的任务列表
//	@Tags			【Team 管理员】团队任务
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			cursor	query		string									false	"分页游标"
//	@Param			limit	query		int										false	"每页数量"
//	@Success		200		{object}	web.Resp{data=domain.TeamTaskListResp}	"成功"
//	@Router			/api/v1/teams/tasks [get]
func (h *TeamDashboardHandler) ListTasks(c *web.Context, req domain.TeamDashboardListReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.ListTasks(c.Request().Context(), teamUser, req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListConversations 获取团队对话列表
//
//	@Summary		获取团队对话列表
//	@Description	获取当前团队任务日志中的 user-input 对话列表
//	@Tags			【Team 管理员】团队对话
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			cursor	query		string											false	"分页游标"
//	@Param			limit	query		int												false	"每页数量"
//	@Success		200		{object}	web.Resp{data=domain.TeamConversationListResp}	"成功"
//	@Router			/api/v1/teams/conversations [get]
func (h *TeamDashboardHandler) ListConversations(c *web.Context, req domain.TeamDashboardListReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.ListConversations(c.Request().Context(), teamUser, req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
