package v1

import (
	"context"
	"log/slog"
	"strings"

	"github.com/GoYoko/web"

	modelkitDomain "github.com/chaitin/ModelKit/domain"
	modelkit "github.com/chaitin/ModelKit/usecase"
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
	active *middleware.ActiveMiddleware,
	readonly *middleware.ReadOnlyMiddleware,
	logger *slog.Logger,
) *ModelHandler {
	m := &ModelHandler{usecase: usecase, logger: logger.With("handler", "model")}

	g := w.Group("/api/v1/model")
	g.Use(auth.Auth(), active.Active("admin"), readonly.Guard())

	g.GET("", web.BaseHandler(m.List))
	g.GET("/provider/supported", web.BindHandler(m.GetProviderModelList))
	g.GET("/token-usage", web.BindHandler(m.GetTokenUsage))
	g.GET("/my", web.BindHandler(m.MyModelList))
	g.POST("", web.BindHandler(m.Create))
	g.POST("/check", web.BindHandler(m.Check))
	g.PUT("", web.BindHandler(m.Update))
	g.DELETE("", web.BaseHandler(m.Delete))

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
//	@Success		200		{object}	web.Resp{data=domain.CheckModelResp}
//	@Router			/api/v1/model/check [post]
func (h *ModelHandler) Check(c *web.Context, req domain.CheckModelReq) error {
	modelkitRes, err := modelkit.CheckModel(c.Request().Context(), &modelkitDomain.CheckModelReq{
		Provider:   string(req.Provider),
		Model:      req.ModelName,
		BaseURL:    req.APIBase,
		APIKey:     req.APIKey,
		APIHeader:  req.APIHeader,
		APIVersion: req.APIVersion,
		Type:       string(req.Type),
	})
	if err != nil {
		return c.Success(domain.CheckModelResp{
			Error: err.Error(),
		})
	}
	if modelkitRes.Error != "" {
		return c.Success(domain.CheckModelResp{
			Error: modelkitRes.Error,
		})
	}

	// 将输出转化为monkeycode格式
	m := &domain.Model{
		ModelType: req.Type,
		Provider:  req.Provider,
		ModelName: req.ModelName,
		APIBase:   req.APIBase,
	}
	// end

	return c.Success(domain.CheckModelResp{
		Model: m,
		Error: "",
	})
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
	admin := middleware.GetAdmin(c)
	req.AdminID = admin.ID
	req.APIBase = strings.TrimSuffix(req.APIBase, "/")
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

// GetProviderModelList 获取供应商支持的模型列表
//
//	@Tags			Model
//	@Summary		获取供应商支持的模型列表
//	@Description	获取供应商支持的模型列表
//	@ID				get-provider-model-list
//	@Accept			json
//	@Produce		json
//	@Param			param	query		domain.GetProviderModelListReq	true	"模型类型"
//	@Success		200		{object}	web.Resp{data=domain.GetProviderModelListResp}
//	@Router			/api/v1/model/provider/supported [get]
func (h *ModelHandler) GetProviderModelList(c *web.Context, req domain.GetProviderModelListReq) error {
	modelkitRes, err := modelkit.ModelList(c.Request().Context(), &modelkitDomain.ModelListReq{
		Provider:  string(req.Provider),
		Type:      string(req.Type),
		BaseURL:   req.BaseURL,
		APIKey:    req.APIKey,
		APIHeader: req.APIHeader,
	})
	if err != nil {
		return err
	}

	// 将输出转化为monkeycode格式
	res := &domain.GetProviderModelListResp{
		Models: make([]domain.ProviderModelListItem, len(modelkitRes.Models)),
	}
	for i, model := range modelkitRes.Models {
		res.Models[i] = domain.ProviderModelListItem{
			Model: model.Model,
		}
	}
	// end

	return c.Success(res)
}

// Delete 删除模型
//
//	@Tags			Model
//	@Summary		删除模型
//	@Description	删除模型
//	@ID				delete-model
//	@Accept			json
//	@Produce		json
//	@Param			id	query		string	true	"模型ID"
//	@Success		200	{object}	web.Resp{}
//	@Router			/api/v1/model [delete]
func (h *ModelHandler) Delete(c *web.Context) error {
	if err := h.usecase.Delete(c.Request().Context(), c.QueryParam("id")); err != nil {
		return err
	}
	return c.Success(nil)
}

func (h *ModelHandler) InitModel() error {
	return h.usecase.InitModel(context.Background())
}
