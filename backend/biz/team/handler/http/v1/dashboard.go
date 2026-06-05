package v1

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type TeamDashboardHandler struct {
	usecase domain.TeamDashboardUsecase
}

func NewTeamDashboardHandler(i *do.Injector) (*TeamDashboardHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &TeamDashboardHandler{
		usecase: do.MustInvoke[domain.TeamDashboardUsecase](i),
	}

	g := w.Group("/api/v1/teams/dashboard")
	g.Use(auth.TeamAuth())
	g.GET("", web.BindHandler(h.Overview))

	return h, nil
}

// Overview 获取团队管理概览
//
//	@Summary		获取团队管理概览
//	@Description	获取团队活跃、任务、耗时、Token 消耗趋势和洞察列表
//	@Tags			【Team 管理员】团队概览
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			range	query		string									false	"时间范围：today、7d、30d"
//	@Success		200		{object}	web.Resp{data=domain.TeamDashboardResp}	"成功"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Failure		500		{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/dashboard [get]
func (h *TeamDashboardHandler) Overview(c *web.Context, req domain.TeamDashboardReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.Overview(c.Request().Context(), teamUser, req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
