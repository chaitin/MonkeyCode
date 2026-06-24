// Package v1 暴露 /api/v1/skills 端点，从 agentresource.Repo 读 DB（agent_skills
// + agent_skill_versions），不再扫描 /app/skills 文件系统。
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

// SkillHandler skill 列表处理器
type SkillHandler struct {
	repo   agentresource.Repo
	db     *db.Client
	logger *slog.Logger
}

// NewSkillHandler 创建 skill handler
func NewSkillHandler(i *do.Injector) (*SkillHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	repo := do.MustInvoke[agentresource.Repo](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)
	logger := do.MustInvoke[*slog.Logger](i).With("handler", "skill.handler")

	h := &SkillHandler{
		repo:   repo,
		db:     do.MustInvoke[*db.Client](i),
		logger: logger,
	}
	g := w.Group("/api/v1/skills")
	g.Use(auth.Auth(), targetActive.TargetActive())
	g.GET("", web.BaseHandler(h.ListEnabled))
	return h, nil
}

// ListEnabled 获取当前用户视角下的 Skill 列表
//
//	@Summary		获取本用户的 Skill 列表
//	@Description	并集返回 (global ∪ 用户 active team ∪ 用户个人) 三级 scope 下、enabled=true 的 skill。禁用的 skill 不返回。
//	@Tags			【用户】任务管理
//	@Security		MonkeyCodeAIAuth
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=[]domain.SkillListItem}	"获取成功"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/skills [get]
func (h *SkillHandler) ListEnabled(c *web.Context) error {
	scope := h.userScope(c)
	items, err := h.repo.ListSkillsForListingScoped(c.Request().Context(), scope)
	if err != nil {
		return err
	}
	resp := make([]*domain.SkillListItem, 0, len(items))
	for _, it := range items {
		// Repo intentionally returns disabled rows so admin pickers can grey
		// them out; the user-facing endpoint hides them entirely.
		if !it.Enabled {
			continue
		}
		groups := make([]domain.SkillGroupRef, 0, len(it.Groups))
		for _, g := range it.Groups {
			groups = append(groups, domain.SkillGroupRef{ID: g.ID.String(), Name: g.Name})
		}
		tags := it.Tags
		if tags == nil {
			tags = []string{}
		}
		resp = append(resp, &domain.SkillListItem{
			ID:              it.ID.String(),
			Name:            it.Name,
			Description:     it.Description,
			Tags:            tags,
			Categories:      it.Categories,
			ActiveVersion:   it.Version,
			IsForceDelivery: it.IsForceDelivery,
			Enabled:         it.Enabled,
			Scope:           domain.SkillScope{Type: it.ScopeType, ID: it.ScopeID},
			Groups:          groups,
		})
	}
	return c.Success(resp)
}

// userScope 从 DB 查用户所在 team(不依赖 session 里的 Team 字段),组装
// ScopeFilter。当前取用户的第一个 team;后续多 team 场景可扩展为并集。
func (h *SkillHandler) userScope(c *web.Context) agentresource.ScopeFilter {
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
