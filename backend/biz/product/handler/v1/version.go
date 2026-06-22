package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type VersionHandler struct {
	provider domain.ProductVersionProvider
	logger   *slog.Logger
}

func NewVersionHandler(i *do.Injector) (*VersionHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	provider, err := do.Invoke[domain.ProductVersionProvider](i)
	h := &VersionHandler{
		provider: provider,
		logger:   do.MustInvoke[*slog.Logger](i).With("handler", "product.version"),
	}
	if err != nil {
		return h, nil
	}

	w.Group("/api/v1/product").GET("/version", web.BaseHandler(h.Get))
	return h, nil
}

// Get 获取产品版本信息
//
//	@Summary		获取产品版本信息
//	@Description	返回当前服务的产品形态，用于前端区分国内 SaaS、海外 SaaS 和私有化版本。
//	@Tags			【产品】版本信息
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.ProductVersion}	"获取成功"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/product/version [get]
func (h *VersionHandler) Get(c *web.Context) error {
	info, err := h.provider.GetProductVersion(c.Request().Context())
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "get product version failed", "error", err)
		return err
	}
	return c.Success(info)
}
