package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// GitBotHandler GitBot 处理器
type GitBotHandler struct {
	usecase domain.GitBotUsecase
	logger  *slog.Logger
}

// NewGitBotHandler 创建 GitBot 处理器
func NewGitBotHandler(i *do.Injector) (*GitBotHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &GitBotHandler{
		usecase: do.MustInvoke[domain.GitBotUsecase](i),
		logger:  do.MustInvoke[*slog.Logger](i).With("module", "handler.GitBotHandler"),
	}

	g := w.Group("/api/v1/users/git-bots")
	g.Use(auth.Auth())
	g.GET("", web.BaseHandler(h.List))
	g.POST("", web.BindHandler(h.Create))
	g.PUT("", web.BindHandler(h.Update))
	g.DELETE("/:id", web.BindHandler(h.Delete))
	g.GET("/tasks", web.BindHandler(h.ListTask))
	g.POST("/share", web.BindHandler(h.ShareBot))

	return h, nil
}

// List 获取用户的 GitBot 列表
//
//	@Summary		Git Bot 列表
//	@Description	Git Bot 列表
//	@Tags			【用户】Git Bot
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=domain.ListGitBotResp}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器错误"
//	@Router			/api/v1/users/git-bots [get]
func (h *GitBotHandler) List(c *web.Context) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user.ID)
	if err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(resp)
}

// Create 创建 GitBot
//
//	@Summary		创建 Git Bot
//	@Description	创建 Git Bot
//	@Tags			【用户】Git Bot
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.CreateGitBotReq			true	"参数"
//	@Success		200	{object}	web.Resp{data=domain.GitBot}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器错误"
//	@Router			/api/v1/users/git-bots [post]
func (h *GitBotHandler) Create(c *web.Context, req domain.CreateGitBotReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Create(c.Request().Context(), user.ID, req)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(resp)
}

// Update 更新 GitBot
//
//	@Summary		更新 Git Bot
//	@Description	更新 Git Bot
//	@Tags			【用户】Git Bot
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.UpdateGitBotReq	true	"参数"
//	@Success		200	{object}	web.Resp{}				"成功"
//	@Failure		401	{object}	web.Resp				"未授权"
//	@Failure		500	{object}	web.Resp				"服务器错误"
//	@Router			/api/v1/users/git-bots [put]
func (h *GitBotHandler) Update(c *web.Context, req domain.UpdateGitBotReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), user.ID, req)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(resp)
}

// Delete 删除 GitBot
//
//	@Summary		删除 Git Bot
//	@Description	删除 Git Bot
//	@Tags			【用户】Git Bot
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器错误"
//	@Router			/api/v1/users/git-bots/{id} [delete]
func (h *GitBotHandler) Delete(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// ListTask 获取 GitBot 任务列表
//
//	@Summary		Git Bot 任务列表
//	@Description	Git Bot 任务列表，支持分页
//	@Tags			【用户】Git Bot
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	query		domain.ListGitBotTaskReq					true	"分页参数，可选 id 指定 Git Bot"
//	@Success		200	{object}	web.Resp{data=domain.ListGitBotTaskResp}	"成功"
//	@Failure		401	{object}	web.Resp									"未授权"
//	@Failure		500	{object}	web.Resp									"服务器错误"
//	@Router			/api/v1/users/git-bots/tasks [get]
func (h *GitBotHandler) ListTask(c *web.Context, req domain.ListGitBotTaskReq) error {
	user := middleware.GetUser(c)
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.Size <= 0 {
		req.Size = 20
	}
	resp, err := h.usecase.ListTask(c.Request().Context(), user.ID, req)
	if err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(resp)
}

// ShareBot 共享 GitBot
//
//	@Summary		分享 Git Bot
//	@Description	分享 Git Bot
//	@Tags			【用户】Git Bot
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.ShareGitBotReq	true	"参数"
//	@Success		200	{object}	web.Resp{}				"成功"
//	@Failure		401	{object}	web.Resp				"未授权"
//	@Failure		500	{object}	web.Resp				"服务器错误"
//	@Router			/api/v1/users/git-bots/share [post]
func (h *GitBotHandler) ShareBot(c *web.Context, req domain.ShareGitBotReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.ShareBot(c.Request().Context(), user.ID, req); err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(nil)
}
