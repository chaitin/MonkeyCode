package v1

import (
	"log/slog"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/internal/middleware"
)

type ModelHandler struct {
	usecase domain.ModelUsecase
	logger  *slog.Logger
}

func NewModelHandler(
	w *web.Web,
	usecase domain.ModelUsecase,
	auth *middleware.AuthMiddleware,
	logger *slog.Logger,
) *ModelHandler {
	m := &ModelHandler{usecase: usecase, logger: logger.With("handler", "model")}

	g := w.Group("/api/v1/model")
	g.Use(auth.Auth())

	g.POST("/check", web.BindHandler(m.Check))
	g.GET("", web.BaseHandler(m.List))
	g.POST("", web.BindHandler(m.Create))
	g.PUT("", web.BindHandler(m.Update))
	g.GET("/token-usage", web.BindHandler(m.GetTokenUsage))
	g.GET("/my", web.BindHandler(m.MyModelList))

	return m
}

// Check 检查模型
//
//	@Tags			Model
//	@Summary		检查模型
//	@Description	检查模型
//	@ID				check-model
//	@Accept			json
//	@Produce		json
//	@Param			model	body		domain.CheckModelReq	true	"模型"
//	@Success		200		{object}	web.Resp{data=domain.Model}
//	@Router			/api/v1/model/check [post]
func (h *ModelHandler) Check(c *web.Context, req domain.CheckModelReq) error {
	m, err := h.usecase.Check(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(m)
}

// List 获取模型列表
//
//	@Tags			Model
//	@Summary		获取模型列表
//	@Description	获取模型列表
//	@ID				list-model
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.AllModelResp}
//	@Router			/api/v1/model [get]
func (h *ModelHandler) List(c *web.Context) error {
	models, err := h.usecase.List(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(models)
}

// MyModelList 获取我的模型列表
//
//	@Tags			Model
//	@Summary		获取我的模型列表
//	@Description	获取我的模型列表
//	@ID				my-model-list
//	@Accept			json
//	@Produce		json
//	@Param			model_type	query		domain.MyModelListReq	true	"模型类型"
//	@Success		200			{object}	web.Resp{data=[]domain.Model}
//	@Router			/api/v1/model/my [get]
func (h *ModelHandler) MyModelList(c *web.Context, req domain.MyModelListReq) error {
	user := middleware.GetUser(c)
	req.UserID = user.ID
	models, err := h.usecase.MyModelList(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(models)
}

// Create 创建模型
//
//	@Tags			Model
//	@Summary		创建模型
//	@Description	创建模型
//	@ID				create-model
//	@Accept			json
//	@Produce		json
//	@Param			model	body		domain.CreateModelReq	true	"模型"
//	@Success		200		{object}	web.Resp{data=domain.Model}
//	@Router			/api/v1/model [post]
func (h *ModelHandler) Create(c *web.Context, req domain.CreateModelReq) error {
	user := middleware.GetUser(c)
	req.UserID = user.ID
	m, err := h.usecase.Create(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(m)
}

// Update 更新模型
//
//	@Tags			Model
//	@Summary		更新模型
//	@Description	更新模型
//	@ID				update-model
//	@Accept			json
//	@Produce		json
//	@Param			model	body		domain.UpdateModelReq	true	"模型"
//	@Success		200		{object}	web.Resp{data=domain.Model}
//	@Router			/api/v1/model [put]
func (h *ModelHandler) Update(c *web.Context, req domain.UpdateModelReq) error {
	m, err := h.usecase.Update(c.Request().Context(), &req)
	if err != nil {
		return err
	}
	return c.Success(m)
}

// GetTokenUsage 获取模型token使用情况
//
//	@Tags			Model
//	@Summary		获取模型token使用情况
//	@Description	获取模型token使用情况
//	@ID				get-token-usage
//	@Accept			json
//	@Produce		json
//	@Param			param	query		domain.GetTokenUsageReq	true	"模型类型"
//	@Success		200		{object}	web.Resp{data=domain.ModelTokenUsageResp}
//	@Router			/api/v1/model/token-usage [get]
func (h *ModelHandler) GetTokenUsage(c *web.Context, req domain.GetTokenUsageReq) error {
	resp, err := h.usecase.GetTokenUsage(c.Request().Context(), req.ModelType)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
