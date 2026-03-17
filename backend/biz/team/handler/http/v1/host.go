package v1

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// TeamHostHandler 团队宿主机处理器
type TeamHostHandler struct {
	usecase domain.TeamHostUsecase
}

// NewTeamHostHandler 创建团队宿主机处理器
func NewTeamHostHandler(i *do.Injector) (*TeamHostHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &TeamHostHandler{
		usecase: do.MustInvoke[domain.TeamHostUsecase](i),
	}

	g := w.Group("/api/v1/teams/hosts")
	g.Use(auth.TeamAuth())

	g.GET("/install-command", web.BaseHandler(h.GetInstallCommand))
	g.GET("", web.BaseHandler(h.List, web.WithPage()))
	g.PUT("/:host_id", web.BindHandler(h.Update))
	g.DELETE("/:host_id", web.BindHandler(h.Delete))

	return h, nil
}

// List 获取团队宿主机列表
//
//	@Summary		获取团队宿主机列表
//	@Description	获取团队宿主机列表
//	@Tags			【Team 管理员】宿主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			page	query		web.Pagination							false	"分页参数"
//	@Success		200		{object}	web.Resp{data=domain.ListTeamHostsResp}	"成功"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Failure		500		{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/hosts [get]
func (h *TeamHostHandler) List(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.List(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetInstallCommand 获取宿主机安装命令
//
//	@Summary		获取宿主机安装命令
//	@Description	获取宿主机安装命令
//	@Tags			【Team 管理员】宿主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Success		200	{object}	web.Resp{data=domain.InstallCommand}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/hosts/install-command [get]
func (h *TeamHostHandler) GetInstallCommand(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	cmd, err := h.usecase.GetInstallCommand(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(domain.InstallCommand{Command: cmd})
}

// Update 更新团队宿主机
//
//	@Summary		更新团队宿主机
//	@Description	更新团队宿主机
//	@Tags			【Team 管理员】宿主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			host_id	path		string						true	"宿主机ID"
//	@Param			param	body		domain.UpdateTeamHostReq	true	"参数"
//	@Success		200		{object}	web.Resp					"成功"
//	@Failure		401		{object}	web.Resp					"未授权"
//	@Failure		500		{object}	web.Resp					"服务器内部错误"
//	@Router			/api/v1/teams/hosts/{host_id} [put]
func (h *TeamHostHandler) Update(c *web.Context, req domain.UpdateTeamHostReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除团队宿主机
//
//	@Summary		删除团队宿主机
//	@Description	删除团队宿主机
//	@Tags			【Team 管理员】宿主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			host_id	path		string		true	"宿主机ID"
//	@Success		200		{object}	web.Resp	"成功"
//	@Failure		401		{object}	web.Resp	"未授权"
//	@Failure		500		{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/hosts/{host_id} [delete]
func (h *TeamHostHandler) Delete(c *web.Context, req domain.DeleteTeamHostReq) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.usecase.Delete(c.Request().Context(), teamUser, &req); err != nil {
		return err
	}
	return c.Success(nil)
}
