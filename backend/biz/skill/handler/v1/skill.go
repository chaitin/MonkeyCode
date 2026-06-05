// Package v1 暴露 /api/v1/skills 端点，从 agentresource.Repo 读 DB（agent_skills
// + agent_skill_versions），不再扫描 /app/skills 文件系统。
package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// SkillHandler skill 列表处理器
type SkillHandler struct {
	repo   agentresource.Repo
	logger *slog.Logger
}

// NewSkillHandler 创建 skill handler
func NewSkillHandler(i *do.Injector) (*SkillHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	repo := do.MustInvoke[agentresource.Repo](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)
	logger := do.MustInvoke[*slog.Logger](i).With("handler", "skill.handler")

	h := &SkillHandler{repo: repo, logger: logger}
	g := w.Group("/api/v1/skills")
	g.Use(auth.Auth(), targetActive.TargetActive())
	g.GET("", web.BaseHandler(h.ListEnabled))
	return h, nil
}

// ListEnabled 获取已启用的 Skills 列表
//
//	@Summary		获取已启用的 Skills 列表
//	@Description	获取所有未删除、非孤儿且具备 active_version 的 Skills，供任务创建器选用
//	@Tags			【公共】skill
//	@Security		MonkeyCodeAIAuth
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=[]domain.SkillListItem}	"获取成功"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/skills [get]
func (h *SkillHandler) ListEnabled(c *web.Context) error {
	items, err := h.repo.ListSkillsForListing(c.Request().Context())
	if err != nil {
		return err
	}
	resp := make([]*domain.SkillListItem, 0, len(items))
	for _, it := range items {
		resp = append(resp, &domain.SkillListItem{
			ID:              it.ID.String(),
			Name:            it.Name,
			Description:     it.Description,
			ActiveVersion:   it.Version,
			IsForceDelivery: it.IsForceDelivery,
		})
	}
	return c.Success(resp)
}
