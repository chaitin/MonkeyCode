package v1

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type UserSkillHandler struct {
	usecase domain.UserSkillUsecase
}

func NewUserSkillHandler(i *do.Injector) (*UserSkillHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &UserSkillHandler{
		usecase: do.MustInvoke[domain.UserSkillUsecase](i),
	}

	g := w.Group("/api/v1/skills")
	g.Use(auth.Auth())
	g.GET("", web.BaseHandler(h.List))

	return h, nil
}

// List 列出当前用户所在团队下可用的 Skill
//
//	@Summary		列出用户当前团队下的 Skill
//	@Description	返回当前用户激活团队下的所有 Skill；PackageURL 为 1h TTL 的预签名 GET URL，前端可直接下载 zip。
//	@Tags			【用户】Skill
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=[]domain.TeamSkill}	"成功"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/skills [get]
func (h *UserSkillHandler) List(c *web.Context) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user)
	if err != nil {
		return err
	}
	skills := resp.Skills
	if skills == nil {
		skills = []*domain.TeamSkill{}
	}
	return c.Success(skills)
}
