package v1

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// TeamImageHandler 团队镜像处理器
type TeamImageHandler struct {
	usecase domain.TeamImageUsecase
}

// NewTeamImageHandler 创建团队镜像处理器
func NewTeamImageHandler(i *do.Injector) (*TeamImageHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)

	h := &TeamImageHandler{
		usecase: do.MustInvoke[domain.TeamImageUsecase](i),
	}

	g := w.Group("/api/v1/teams/images")
	g.Use(auth.TeamAuth())
	g.GET("", web.BaseHandler(h.List))
	g.POST("", web.BindHandler(h.Add), audit.Audit("add_team_image"))
	g.PUT("/:image_id", web.BindHandler(h.Update), audit.Audit("update_team_image"))
	g.DELETE("/:image_id", web.BindHandler(h.Delete), audit.Audit("delete_team_image"))

	return h, nil
}

// List 获取团队镜像列表
//
//	@Summary		获取团队镜像列表
//	@Description	获取团队镜像列表
//	@Tags			【Team 管理员】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Success		200	{object}	web.Resp{data=domain.ListTeamImagesResp}	"成功"
//	@Failure		401	{object}	web.Resp									"未授权"
//	@Failure		500	{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/teams/images [get]
func (h *TeamImageHandler) List(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.List(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Add 添加团队镜像
//
//	@Summary		添加团队镜像
//	@Description	添加团队镜像
//	@Tags			【Team 管理员】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.AddTeamImageReq			true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.TeamImage}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/images [post]
func (h *TeamImageHandler) Add(c *web.Context, req domain.AddTeamImageReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Add(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 更新团队镜像
//
//	@Summary		更新团队镜像
//	@Description	更新团队镜像
//	@Tags			【Team 管理员】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			image_id	path		string							true	"镜像ID"
//	@Param			req			body		domain.UpdateTeamImageReq		true	"请求参数"
//	@Success		200			{object}	web.Resp{data=domain.TeamImage}	"成功"
//	@Failure		401			{object}	web.Resp						"未授权"
//	@Failure		500			{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/teams/images/{image_id} [put]
func (h *TeamImageHandler) Update(c *web.Context, req domain.UpdateTeamImageReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除团队镜像
//
//	@Summary		删除团队镜像
//	@Description	删除团队镜像
//	@Tags			【Team 管理员】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			image_id	path		string		true	"镜像ID"
//	@Success		200			{object}	web.Resp{}	"成功"
//	@Failure		401			{object}	web.Resp	"未授权"
//	@Failure		500			{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/images/{image_id} [delete]
func (h *TeamImageHandler) Delete(c *web.Context, req domain.DeleteTeamImageReq) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.usecase.Delete(c.Request().Context(), teamUser, &req); err != nil {
		return err
	}
	return c.Success(nil)
}
