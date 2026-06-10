package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type TeamOIDCHandler struct {
	logger  *slog.Logger
	usecase domain.TeamOIDCUsecase
}

func NewTeamOIDCHandler(i *do.Injector) (*TeamOIDCHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	logger := do.MustInvoke[*slog.Logger](i)

	h := &TeamOIDCHandler{
		logger:  logger.With("module", "handler.team_oidc"),
		usecase: do.MustInvoke[domain.TeamOIDCUsecase](i),
	}

	g := w.Group("/api/v1/teams/oidc")
	g.GET("", web.BaseHandler(h.Get), auth.TeamAuth())
	g.PUT("", web.BindHandler(h.Save), auth.TeamAuth())
	g.POST("/test", web.BindHandler(h.Test), auth.TeamAuth())

	return h, nil
}

// Get 获取团队 OIDC 配置
//
//	@Summary		获取团队 OIDC 配置
//	@Description	获取当前团队企业登录 OIDC 配置
//	@Tags			【Team 管理员】企业登录
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Success		200	{object}	web.Resp{data=domain.TeamOIDCConfigResp}
//	@Router			/api/v1/teams/oidc [get]
func (h *TeamOIDCHandler) Get(c *web.Context) error {
	resp, err := h.usecase.GetConfig(c.Request().Context(), middleware.GetTeamUser(c))
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Save 保存团队 OIDC 配置
//
//	@Summary		保存团队 OIDC 配置
//	@Description	新增或更新当前团队企业登录 OIDC 配置
//	@Tags			【Team 管理员】企业登录
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.SaveTeamOIDCConfigReq	true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.TeamOIDCConfigResp}
//	@Router			/api/v1/teams/oidc [put]
func (h *TeamOIDCHandler) Save(c *web.Context, req domain.SaveTeamOIDCConfigReq) error {
	resp, err := h.usecase.SaveConfig(c.Request().Context(), middleware.GetTeamUser(c), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Test 测试团队 OIDC 配置
//
//	@Summary		测试团队 OIDC 配置
//	@Description	拉取 OIDC discovery 文档验证配置可用性
//	@Tags			【Team 管理员】企业登录
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.SaveTeamOIDCConfigReq	true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.TeamOIDCTestResp}
//	@Router			/api/v1/teams/oidc/test [post]
func (h *TeamOIDCHandler) Test(c *web.Context, req domain.SaveTeamOIDCConfigReq) error {
	resp, err := h.usecase.TestConfig(c.Request().Context(), middleware.GetTeamUser(c), &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
