package v1

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// TeamModelHandler 团队模型配置处理器
type TeamModelHandler struct {
	usecase domain.TeamModelUsecase
}

// NewTeamModelHandler 创建团队模型配置处理器
func NewTeamModelHandler(i *do.Injector) (*TeamModelHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)

	h := &TeamModelHandler{
		usecase: do.MustInvoke[domain.TeamModelUsecase](i),
	}

	g := w.Group("/api/v1/teams/models")
	g.Use(auth.TeamAuth())
	g.GET("", web.BaseHandler(h.List))
	g.POST("", web.BindHandler(h.Add), audit.Audit("add_team_model"))
	g.PUT("/:model_id", web.BindHandler(h.Update), audit.Audit("update_team_model"))
	g.DELETE("/:model_id", web.BindHandler(h.Delete), audit.Audit("delete_team_model"))
	g.GET("/:id/health-check", web.BindHandler(h.CheckByID))
	g.POST("/health-check", web.BindHandler(h.CheckByConfig))

	return h, nil
}

// List 获取团队模型配置列表
//
//	@Summary		获取团队模型配置列表
//	@Description	获取团队模型配置列表
//	@Tags			【Team 管理员】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Success		200	{object}	web.Resp{data=domain.ListTeamModelsResp}	"成功"
//	@Failure		401	{object}	web.Resp									"未授权"
//	@Failure		500	{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/teams/models [get]
func (h *TeamModelHandler) List(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.List(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Add 添加团队模型配置
//
//	@Summary		添加团队模型配置
//	@Description	添加团队模型配置
//	@Tags			【Team 管理员】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.AddTeamModelReq			true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.TeamModel}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/models [post]
func (h *TeamModelHandler) Add(c *web.Context, req domain.AddTeamModelReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Add(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 更新团队模型配置
//
//	@Summary		更新团队模型配置
//	@Description	更新团队模型配置
//	@Tags			【Team 管理员】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			model_id	path		string							true	"模型ID"
//	@Param			req			body		domain.UpdateTeamModelReq		true	"请求参数"
//	@Success		200			{object}	web.Resp{data=domain.TeamModel}	"成功"
//	@Failure		401			{object}	web.Resp						"未授权"
//	@Failure		500			{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/models/{model_id} [put]
func (h *TeamModelHandler) Update(c *web.Context, req domain.UpdateTeamModelReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除团队模型配置
//
//	@Summary		删除团队模型配置
//	@Description	删除团队模型配置
//	@Tags			【Team 管理员】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			model_id	path		string		true	"模型ID"
//	@Success		200			{object}	web.Resp{}	"成功"
//	@Failure		401			{object}	web.Resp	"未授权"
//	@Failure		500			{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/models/{model_id} [delete]
func (h *TeamModelHandler) Delete(c *web.Context, req domain.DeleteTeamModelReq) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.usecase.Delete(c.Request().Context(), teamUser, &req); err != nil {
		return err
	}
	return c.Success(nil)
}

// CheckByID 检查团队模型健康状态（通过ID）
//
//	@Summary		检查团队模型健康状态（通过ID）
//	@Description	对指定团队模型进行健康检查，并更新检查结果到数据库
//	@Tags			【Team 管理员】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			id	path		string									true	"模型配置ID"
//	@Success		200	{object}	web.Resp{data=domain.CheckModelResp}	"成功"
//	@Failure		400	{object}	web.Resp								"请求参数错误"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		404	{object}	web.Resp								"资源不存在"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/models/{id}/health-check [get]
func (h *TeamModelHandler) CheckByID(c *web.Context, req domain.CheckModelReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Check(c.Request().Context(), teamUser, req.ID)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// CheckByConfig 检查团队模型健康状态（通过配置）
//
//	@Summary		检查团队模型健康状态（通过配置）
//	@Description	使用提供的配置进行健康检查，不更新数据库
//	@Tags			【Team 管理员】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.CheckByConfigReq					true	"检查模型配置请求"
//	@Success		200	{object}	web.Resp{data=domain.CheckModelResp}	"成功"
//	@Failure		400	{object}	web.Resp								"请求参数错误"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/models/health-check [post]
func (h *TeamModelHandler) CheckByConfig(c *web.Context, req domain.CheckByConfigReq) error {
	resp, err := h.usecase.CheckByConfig(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
