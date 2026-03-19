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
func (h *GitBotHandler) List(c *web.Context) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user.ID)
	if err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(resp)
}

// Create 创建 GitBot
func (h *GitBotHandler) Create(c *web.Context, req domain.CreateGitBotReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Create(c.Request().Context(), user.ID, req)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(resp)
}

// Update 更新 GitBot
func (h *GitBotHandler) Update(c *web.Context, req domain.UpdateGitBotReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), user.ID, req)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(resp)
}

// Delete 删除 GitBot
func (h *GitBotHandler) Delete(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// ListTask 获取 GitBot 任务列表
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
func (h *GitBotHandler) ShareBot(c *web.Context, req domain.ShareGitBotReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.ShareBot(c.Request().Context(), user.ID, req); err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(nil)
}
