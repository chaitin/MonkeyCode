package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type Handler struct {
	logger *slog.Logger
}

func NewHandler(i *do.Injector) (*Handler, error) {
	w := do.MustInvoke[*web.Web](i)
	logger := do.MustInvoke[*slog.Logger](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &Handler{logger: logger.With("module", "subscription.handler")}
	w.GET("/api/v1/users/subscription", web.BaseHandler(h.Get), auth.Auth(), targetActive.TargetActive())
	return h, nil
}

// Get 查询开源版订阅状态
//
//	@Summary		查询当前会员状态
//	@Description	开源版固定返回基础订阅状态
//	@Tags			【用户】会员
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=domain.SubscriptionResp}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权，用户未登录"
//	@Router			/api/v1/users/subscription [get]
func (h *Handler) Get(c *web.Context) error {
	if middleware.GetUser(c) == nil {
		return errcode.ErrUnauthorized
	}
	return c.Success(domain.SubscriptionResp{
		Plan:      "pro",
		AutoRenew: false,
	})
}
