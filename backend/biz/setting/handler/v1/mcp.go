package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type MCPHandler struct {
	usecase domain.UserMCPUsecase
	logger  *slog.Logger
}

func NewMCPHandler(i *do.Injector) (*MCPHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	logger := do.MustInvoke[*slog.Logger](i)
	usecase := do.MustInvoke[domain.UserMCPUsecase](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &MCPHandler{
		logger:  logger.With("component", "handler.mcp"),
		usecase: usecase,
	}

	v1 := w.Group("/api/v1/users/mcp")
	v1.Use(auth.Auth(), targetActive.TargetActive())
	v1.GET("/upstreams", web.BindHandler(h.ListUpstreams))
	v1.POST("/upstreams", web.BindHandler(h.CreateUpstream))
	v1.PUT("/upstreams/:id", web.BindHandler(h.UpdateUpstream))
	v1.DELETE("/upstreams/:id", web.BindHandler(h.DeleteUpstream))
	v1.POST("/upstreams/:id/sync", web.BindHandler(h.SyncUpstream))
	v1.PUT("/tools/:id", web.BindHandler(h.UpdateToolSetting))

	return h, nil
}

// ListUpstreams 获取当前用户的 MCP Upstream 列表
//
//	@Summary		获取当前用户的 MCP Upstream 列表
//	@Description	获取当前登录用户可管理的 MCP Upstream 列表
//	@Tags			【用户】MCP 配置
//	@Accept			json
//	@Produce		json
//	@Param			req	query	domain.CursorReq	true	"游标分页请求"
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=domain.ListUserMCPUpstreamsResp}	"成功"
//	@Failure		401	{object}	web.Resp										"未授权"
//	@Failure		500	{object}	web.Resp										"服务器内部错误"
//	@Router			/api/v1/users/mcp/upstreams [get]
func (h *MCPHandler) ListUpstreams(c *web.Context, req domain.CursorReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.ListUpstreams(c.Request().Context(), user.ID, req)
	if err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(resp)
}

// CreateUpstream 创建当前用户的 MCP Upstream
//
//	@Summary		创建当前用户的 MCP Upstream
//	@Description	为当前登录用户创建自定义 MCP Upstream
//	@Tags			【用户】MCP 配置
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.CreateUserMCPUpstreamReq		true	"创建 MCP Upstream 请求"
//	@Success		200	{object}	web.Resp{data=domain.MCPUpstream}	"成功"
//	@Failure		400	{object}	web.Resp							"请求参数错误"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/mcp/upstreams [post]
func (h *MCPHandler) CreateUpstream(c *web.Context, req domain.CreateUserMCPUpstreamReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.CreateUpstream(c.Request().Context(), user.ID, req)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(resp)
}

// UpdateUpstream 更新当前用户的 MCP Upstream
//
//	@Summary		更新当前用户的 MCP Upstream
//	@Description	更新当前登录用户指定的 MCP Upstream 配置
//	@Tags			【用户】MCP 配置
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string							true	"MCP Upstream ID"
//	@Param			req	body		domain.UpdateUserMCPUpstreamReq	true	"更新 MCP Upstream 请求"
//	@Success		200	{object}	web.Resp{}						"成功"
//	@Failure		400	{object}	web.Resp						"请求参数错误"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		404	{object}	web.Resp						"资源不存在"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/users/mcp/upstreams/{id} [put]
func (h *MCPHandler) UpdateUpstream(c *web.Context, req domain.UpdateUserMCPUpstreamReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.UpdateUpstream(c.Request().Context(), user.ID, req.ID, req); err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// DeleteUpstream 删除当前用户的 MCP Upstream
//
//	@Summary		删除当前用户的 MCP Upstream
//	@Description	删除当前登录用户指定的 MCP Upstream
//	@Tags			【用户】MCP 配置
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"MCP Upstream ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		400	{object}	web.Resp	"请求参数错误"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		404	{object}	web.Resp	"资源不存在"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/mcp/upstreams/{id} [delete]
func (h *MCPHandler) DeleteUpstream(c *web.Context, req domain.DeleteUserMCPUpstreamReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.DeleteUpstream(c.Request().Context(), user.ID, req.ID); err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// SyncUpstream 同步当前用户的 MCP Upstream
//
//	@Summary		同步当前用户的 MCP Upstream
//	@Description	触发当前登录用户指定 MCP Upstream 的工具同步
//	@Tags			【用户】MCP 配置
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"MCP Upstream ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		400	{object}	web.Resp	"请求参数错误"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		404	{object}	web.Resp	"资源不存在"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/mcp/upstreams/{id}/sync [post]
func (h *MCPHandler) SyncUpstream(c *web.Context, req domain.SyncUserMCPUpstreamReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.SyncUpstream(c.Request().Context(), user.ID, req.ID); err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// UpdateToolSetting 更新当前用户的 MCP Tool 开关配置
//
//	@Summary		更新当前用户的 MCP Tool 开关配置
//	@Description	更新当前登录用户指定 MCP Tool 的启用状态
//	@Tags			【用户】MCP 配置
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string								true	"MCP Tool ID"
//	@Param			req	body		domain.UpdateUserMCPToolSettingReq	true	"更新 MCP Tool 开关请求"
//	@Success		200	{object}	web.Resp{}							"成功"
//	@Failure		400	{object}	web.Resp							"请求参数错误"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		404	{object}	web.Resp							"资源不存在"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/mcp/tools/{id} [put]
func (h *MCPHandler) UpdateToolSetting(c *web.Context, req domain.UpdateUserMCPToolSettingReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.UpdateToolSetting(c.Request().Context(), user.ID, req.ID, req.Enabled); err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}
