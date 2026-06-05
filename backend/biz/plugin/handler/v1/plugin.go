// Package v1 暴露 /api/v1/plugins 端点，从 agentresource.Repo 读 DB。仅
// OpenCode CLI 会真正下发 plugin 资产，但列表端点对所有任务创建器可见。
package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// PluginHandler plugin 列表处理器
type PluginHandler struct {
	repo   agentresource.Repo
	logger *slog.Logger
}

// NewPluginHandler 创建 plugin handler
func NewPluginHandler(i *do.Injector) (*PluginHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	repo := do.MustInvoke[agentresource.Repo](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)
	logger := do.MustInvoke[*slog.Logger](i).With("handler", "plugin.handler")

	h := &PluginHandler{repo: repo, logger: logger}
	g := w.Group("/api/v1/plugins")
	g.Use(auth.Auth(), targetActive.TargetActive())
	g.GET("", web.BaseHandler(h.ListEnabled))
	return h, nil
}

// ListEnabled 获取已启用的 Plugins 列表
//
//	@Summary		获取已启用的 Plugins 列表
//	@Description	获取所有未删除、非孤儿且具备 active_version 的 Plugins，供任务创建器选用（仅 OpenCode 真正下发）
//	@Tags			【公共】plugin
//	@Security		MonkeyCodeAIAuth
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=[]domain.PluginListItem}	"获取成功"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/plugins [get]
func (h *PluginHandler) ListEnabled(c *web.Context) error {
	items, err := h.repo.ListPluginsForListing(c.Request().Context())
	if err != nil {
		return err
	}
	resp := make([]*domain.PluginListItem, 0, len(items))
	for _, it := range items {
		resp = append(resp, &domain.PluginListItem{
			ID:              it.ID.String(),
			Name:            it.Name,
			Description:     it.Description,
			Entry:           it.Entry,
			ActiveVersion:   it.Version,
			IsForceDelivery: it.IsForceDelivery,
		})
	}
	return c.Success(resp)
}
