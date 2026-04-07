package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// ImageHandler 镜像配置处理器
type ImageHandler struct {
	usecase domain.ImageUsecase
	logger  *slog.Logger
}

// NewImageHandler 创建镜像配置处理器
func NewImageHandler(i *do.Injector) (*ImageHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	logger := do.MustInvoke[*slog.Logger](i)
	usecase := do.MustInvoke[domain.ImageUsecase](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &ImageHandler{
		logger:  logger.With("component", "handler.images"),
		usecase: usecase,
	}

	v1 := w.Group("/api/v1/users/images")

	v1.Use(auth.Auth(), targetActive.TargetActive())
	v1.GET("", web.BindHandler(h.List))
	v1.POST("", web.BindHandler(h.Create))
	v1.DELETE("/:id", web.BindHandler(h.Delete))
	v1.PUT("/:id", web.BindHandler(h.Update))

	return h, nil
}

// List 获取当前用户的镜像配置列表
//
//	@Summary		获取当前用户的镜像配置列表
//	@Description	获取当前登录用户的所有镜像配置
//	@Tags			【用户】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			page	query		domain.CursorReq					true	"分页参数"
//	@Success		200		{object}	web.Resp{data=domain.ListImageResp}	"成功"
//	@Failure		401		{object}	web.Resp							"未授权"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/images [get]
func (h *ImageHandler) List(c *web.Context, req domain.CursorReq) error {
	if req.Limit <= 0 {
		req.Limit = 100
	}
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user.ID, req)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to list user images", "error", err, "user_id", user.ID)
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(resp)
}

// Create 创建镜像配置
//
//	@Summary		创建镜像配置
//	@Description	为当前用户创建新的镜像配置
//	@Tags			【用户】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.CreateImageReq		true	"创建镜像配置请求"
//	@Success		200	{object}	web.Resp{data=domain.Image}	"成功"
//	@Failure		400	{object}	web.Resp					"请求参数错误"
//	@Failure		401	{object}	web.Resp					"未授权"
//	@Failure		500	{object}	web.Resp					"服务器内部错误"
//	@Router			/api/v1/users/images [post]
func (h *ImageHandler) Create(c *web.Context, req domain.CreateImageReq) error {
	user := middleware.GetUser(c)
	i, err := h.usecase.Create(c.Request().Context(), user.ID, &req)
	if err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(i)
}

// Delete 删除镜像配置
//
//	@Summary		删除镜像配置
//	@Description	删除指定的镜像配置
//	@Tags			【用户】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string									true	"镜像配置ID"
//	@Success		200	{object}	web.Resp{data=domain.DeleteImageReq}	"成功"
//	@Failure		400	{object}	web.Resp								"请求参数错误"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		404	{object}	web.Resp								"资源不存在"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/images/{id} [delete]
func (h *ImageHandler) Delete(c *web.Context, req domain.DeleteImageReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// Update 更新镜像配置
//
//	@Summary		更新镜像配置
//	@Description	更新指定的镜像配置信息
//	@Tags			【用户】镜像管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		path		string						true	"镜像配置ID"
//	@Param			request	body		domain.UpdateImageReq		true	"更新镜像配置请求"
//	@Success		200		{object}	web.Resp{data=domain.Image}	"成功"
//	@Failure		400		{object}	web.Resp					"请求参数错误"
//	@Failure		401		{object}	web.Resp					"未授权"
//	@Failure		404		{object}	web.Resp					"资源不存在"
//	@Failure		500		{object}	web.Resp					"服务器内部错误"
//	@Router			/api/v1/users/images/{id} [put]
func (h *ImageHandler) Update(c *web.Context, req domain.UpdateImageReq) error {
	user := middleware.GetUser(c)
	i, err := h.usecase.Update(c.Request().Context(), user.ID, req.ID, &req)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(i)
}
