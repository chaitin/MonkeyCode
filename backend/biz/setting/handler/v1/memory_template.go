package v1

import (
	"log/slog"
	"net/http"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// MemoryTemplateHandler Memory模板处理器
type MemoryTemplateHandler struct {
	usecase domain.UserUsecase
	logger  *slog.Logger
}

// NewMemoryTemplateHandler 创建Memory模板处理器
func NewMemoryTemplateHandler(i *do.Injector) (*MemoryTemplateHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	logger := do.MustInvoke[*slog.Logger](i)
	usecase := do.MustInvoke[domain.UserUsecase](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &MemoryTemplateHandler{
		logger:  logger.With("component", "handler.memory-template"),
		usecase: usecase,
	}

	v1 := w.Group("/api/v1/users/settings")

	v1.Use(auth.Auth(), targetActive.TargetActive())
	v1.GET("/memory-template", web.BindHandler(h.Get))
	v1.PUT("/memory-template", web.BindHandler(h.Update))
	v1.DELETE("/memory-template", web.BindHandler(h.Delete))

	return h, nil
}

// GetMemoryTemplateReq 获取Memory模板请求
type GetMemoryTemplateReq struct{}

// Get 获取用户Memory模板
//
//	@Summary		获取用户Memory模板
//	@Description	获取当前用户的Memory模板设置
//	@Tags			【用户】Memory模板
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=string}	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/settings/memory-template [get]
func (h *MemoryTemplateHandler) Get(c *web.Context, req GetMemoryTemplateReq) error {
	user := middleware.GetUser(c)

	u, err := h.usecase.Get(c.Request().Context(), user.ID)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to get user memory template", "error", err, "user_id", user.ID)
		return errcode.ErrDatabaseQuery.Wrap(err)
	}

	// 如果用户没有设置模板，返回空字符串
	if u == nil || u.MemoryTemplate == nil {
		return c.Success("")
	}

	return c.Success(*u.MemoryTemplate)
}

// UpdateMemoryTemplateReq 更新Memory模板请求
type UpdateMemoryTemplateReq struct {
	MemoryTemplate string `json:"memory_template"`
}

// Update 更新用户Memory模板
//
//	@Summary		更新用户Memory模板
//	@Description	更新当前用户的Memory模板设置
//	@Tags			【用户】Memory模板
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		UpdateMemoryTemplateReq	true	"更新Memory模板请求"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		400	{object}	web.Resp	"请求参数错误"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/settings/memory-template [put]
func (h *MemoryTemplateHandler) Update(c *web.Context, req UpdateMemoryTemplateReq) error {
	user := middleware.GetUser(c)

	// 验证模板大小（最大 500KB）
	if len(req.MemoryTemplate) > 500*1024 {
		return c.JSON(http.StatusBadRequest, map[string]interface{}{
			"code":    400,
			"message": "模板大小超过限制（最大500KB）",
		})
	}

	// 更新用户Memory模板
	_, err := h.usecase.Update(c.Request().Context(), user.ID, "", domain.UpdateUserReq{
		MemoryTemplate: &req.MemoryTemplate,
	})
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to update user memory template", "error", err, "user_id", user.ID)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}

	return c.Success(nil)
}

// DeleteMemoryTemplateReq 删除Memory模板请求
type DeleteMemoryTemplateReq struct{}

// Delete 删除用户Memory模板（恢复默认）
//
//	@Summary		删除用户Memory模板
//	@Description	删除当前用户的Memory模板设置，恢复为默认
//	@Tags			【用户】Memory模板
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/settings/memory-template [delete]
func (h *MemoryTemplateHandler) Delete(c *web.Context, req DeleteMemoryTemplateReq) error {
	user := middleware.GetUser(c)

	// 将模板设为空字符串
	emptyTemplate := ""
	_, err := h.usecase.Update(c.Request().Context(), user.ID, "", domain.UpdateUserReq{
		MemoryTemplate: &emptyTemplate,
	})
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to delete user memory template", "error", err, "user_id", user.ID)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}

	return c.Success(nil)
}
