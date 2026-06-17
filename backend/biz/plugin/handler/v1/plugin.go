// Package v1 暴露 /api/v1/plugins 端点，从 agentresource.Repo 读 DB。仅
// OpenCode CLI 会真正下发 plugin 资产，但列表端点对所有任务创建器可见。
package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// PluginHandler plugin 列表处理器
type PluginHandler struct {
	repo   agentresource.Repo
	db     *db.Client
	logger *slog.Logger
}

// NewPluginHandler 创建 plugin handler
func NewPluginHandler(i *do.Injector) (*PluginHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	repo := do.MustInvoke[agentresource.Repo](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)
	logger := do.MustInvoke[*slog.Logger](i).With("handler", "plugin.handler")

	h := &PluginHandler{
		repo:   repo,
		db:     do.MustInvoke[*db.Client](i),
		logger: logger,
	}
	g := w.Group("/api/v1/plugins")
	g.Use(auth.Auth(), targetActive.TargetActive())
	g.GET("", web.BaseHandler(h.ListEnabled))
	return h, nil
}

// ListEnabled 获取当前用户视角下的 Plugins 列表
//
//	@Summary		获取 Plugins 列表
//	@Description	并集返回 (global ∪ 用户 active team) 两级 scope 下的 plugin,同名 team>global 覆盖;disabled 仍返回但 enabled=false。
//	@Tags			【公共】plugin
//	@Security		MonkeyCodeAIAuth
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=[]domain.PluginListItem}	"获取成功"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/plugins [get]
func (h *PluginHandler) ListEnabled(c *web.Context) error {
	scope := h.userScope(c)
	items, err := h.repo.ListPluginsForListingScoped(c.Request().Context(), scope)
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
			Enabled:         it.Enabled,
			Scope:           domain.SkillScope{Type: it.ScopeType, ID: it.ScopeID},
		})
	}
	return c.Success(resp)
}

func (h *PluginHandler) userScope(c *web.Context) agentresource.ScopeFilter {
	f := agentresource.ScopeFilter{IncludeGlobal: true}
	user := middleware.GetUser(c)
	if user == nil {
		return f
	}
	member, err := h.db.TeamMember.Query().
		Where(teammember.UserIDEQ(user.ID)).
		First(c.Request().Context())
	if err != nil {
		h.logger.WarnContext(c.Request().Context(), "userScope: query team_members failed",
			"user_id", user.ID, "error", err)
		return f
	}
	teamID := member.TeamID
	f.TeamID = &teamID
	return f
}
