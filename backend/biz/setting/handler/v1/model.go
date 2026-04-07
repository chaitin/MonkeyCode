package v1

import (
	"log/slog"
	"strings"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// ModelHandler 模型配置处理器
type ModelHandler struct {
	usecase domain.ModelUsecase
	logger  *slog.Logger
}

// NewModelHandler 创建模型配置处理器
func NewModelHandler(i *do.Injector) (*ModelHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	logger := do.MustInvoke[*slog.Logger](i)
	usecase := do.MustInvoke[domain.ModelUsecase](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &ModelHandler{
		logger:  logger.With("component", "handler.models"),
		usecase: usecase,
	}

	v1 := w.Group("/api/v1/users/models")

	v1.GET("/providers", web.BindHandler(h.GetProviderModelList))

	v1.Use(auth.Auth(), targetActive.TargetActive())
	v1.GET("", web.BindHandler(h.List))
	v1.POST("", web.BindHandler(h.Create))
	v1.PUT("/:id", web.BindHandler(h.Update))
	v1.DELETE("/:id", web.BindHandler(h.Delete))
	v1.GET("/:id/health-check", web.BindHandler(h.CheckByID))
	v1.POST("/health-check", web.BindHandler(h.CheckByConfig))

	return h, nil
}

// List 获取当前用户的模型配置列表
//
//	@Summary		获取当前用户的模型配置列表
//	@Description	获取当前登录用户的所有模型配置
//	@Tags			【用户】模型管理
//	@Accept			json
//	@Produce		json
//	@Param			page	query	domain.CursorReq	true	"创建模型配置请求"
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=domain.ListModelResp}	"成功"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/models [get]
func (h *ModelHandler) List(c *web.Context, req domain.CursorReq) error {
	if req.Limit <= 0 {
		req.Limit = 100
	}
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user.ID, req)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to list user model configs", "error", err, "user_id", user.ID)
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(resp)
}

// Create 创建模型配置
//
//	@Summary		创建模型配置
//	@Description	为当前用户创建新的模型配置
//	@Tags			【用户】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.CreateModelReq		true	"创建模型配置请求"
//	@Success		200	{object}	web.Resp{data=domain.Model}	"成功"
//	@Failure		400	{object}	web.Resp					"请求参数错误"
//	@Failure		401	{object}	web.Resp					"未授权"
//	@Failure		500	{object}	web.Resp					"服务器内部错误"
//	@Router			/api/v1/users/models [post]
func (h *ModelHandler) Create(c *web.Context, req domain.CreateModelReq) error {
	user := middleware.GetUser(c)
	model, err := h.usecase.Create(c.Request().Context(), user.ID, &req)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to create model config", "error", err, "user_id", user.ID)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(model)
}

// Delete 删除模型配置
//
//	@Summary		删除模型配置
//	@Description	删除指定的模型配置
//	@Tags			【用户】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"模型配置ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		400	{object}	web.Resp	"请求参数错误"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		404	{object}	web.Resp	"资源不存在"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/models/{id} [delete]
func (h *ModelHandler) Delete(c *web.Context, req domain.DeleteModelConfigReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to delete model config", "error", err, "user_id", user.ID, "model_id", req.ID)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// Update 更新模型配置
//
//	@Summary		更新模型配置
//	@Description	更新指定的模型配置信息
//	@Tags			【用户】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		path		string					true	"模型配置ID"
//	@Param			request	body		domain.UpdateModelReq	true	"更新模型配置请求"
//	@Success		200		{object}	web.Resp{}				"成功"
//	@Failure		400		{object}	web.Resp				"请求参数错误"
//	@Failure		401		{object}	web.Resp				"未授权"
//	@Failure		404		{object}	web.Resp				"资源不存在"
//	@Failure		500		{object}	web.Resp				"服务器内部错误"
//	@Router			/api/v1/users/models/{id} [put]
func (h *ModelHandler) Update(c *web.Context, req domain.UpdateModelReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Update(c.Request().Context(), user.ID, req.ID, &req); err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to update model config", "error", err, "user_id", user.ID, "model_id", req.ID)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(nil)
}

// GetProviderModelList 获取供应商支持的模型列表
//
//	@Tags			【用户】模型管理
//	@Summary		获取供应商支持的模型列表
//	@Description	获取供应商支持的模型列表
//	@ID				get-provider-model-list
//	@Accept			json
//	@Produce		json
//	@Param			param	query		domain.GetProviderModelListReq	true	"模型类型"
//	@Success		200		{object}	web.Resp{data=domain.GetProviderModelListResp}
//	@Router			/api/v1/users/models/providers [get]
func (h *ModelHandler) GetProviderModelList(c *web.Context, req domain.GetProviderModelListReq) error {
	resp, err := h.usecase.GetProviderModelList(c.Request().Context(), &req)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to get provider model list", "error", err, "provider", req.Provider)
		if strings.Contains(err.Error(), "401") {
			return errcode.ErrInvalidAPIKey.Wrap(err)
		}
		return errcode.ErrInvalidParameter.Wrap(err)
	}
	return c.Success(resp)
}

// CheckByID 检查模型健康状态（通过ID）
//
//	@Summary		检查模型健康状态（通过ID）
//	@Description	对指定模型进行健康检查，并更新检查结果到数据库
//	@Tags			【用户】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string									true	"模型配置ID"
//	@Success		200	{object}	web.Resp{data=domain.CheckModelResp}	"成功"
//	@Failure		400	{object}	web.Resp								"请求参数错误"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		404	{object}	web.Resp								"资源不存在"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/models/{id}/health-check [get]
func (h *ModelHandler) CheckByID(c *web.Context, req domain.CheckModelReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Check(c.Request().Context(), user.ID, req.ID)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to check model by id", "error", err, "user_id", user.ID, "model_id", req.ID)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(resp)
}

// CheckByConfig 检查模型健康状态（通过配置）
//
//	@Summary		检查模型健康状态（通过配置）
//	@Description	使用提供的配置进行健康检查，不更新数据库
//	@Tags			【用户】模型管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.CheckByConfigReq					true	"检查模型配置请求"
//	@Success		200	{object}	web.Resp{data=domain.CheckModelResp}	"成功"
//	@Failure		400	{object}	web.Resp								"请求参数错误"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/models/health-check [post]
func (h *ModelHandler) CheckByConfig(c *web.Context, req domain.CheckByConfigReq) error {
	resp, err := h.usecase.CheckByConfig(c.Request().Context(), &req)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to check model by config", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return c.Success(resp)
}
