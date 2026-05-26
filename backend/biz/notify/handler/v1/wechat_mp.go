package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// WechatMPHandler 微信公众号绑定处理器
type WechatMPHandler struct {
	usecase domain.WechatMPUsecase
	logger  *slog.Logger
}

// NewWechatMPHandler 创建微信公众号绑定处理器
func NewWechatMPHandler(i *do.Injector) (*WechatMPHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &WechatMPHandler{
		usecase: do.MustInvoke[domain.WechatMPUsecase](i),
		logger:  do.MustInvoke[*slog.Logger](i).With("module", "wechat_mp.handler"),
	}

	g := w.Group("/api/v1/users/wechat-mp")
	g.Use(auth.Auth(), targetActive.TargetActive())
	g.POST("/bind-qrcode", web.BaseHandler(h.CreateBindQRCode))
	g.DELETE("/bind", web.BaseHandler(h.Unbind))

	return h, nil
}

// CreateBindQRCode 创建公众号绑定二维码
//
//	@Summary		创建公众号绑定二维码
//	@Description	为当前登录用户创建微信公众号绑定临时二维码，用户扫码关注/扫码后完成绑定
//	@Tags			【用户】微信公众号推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=domain.BindQRCodeResp}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权，用户未登录"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/wechat-mp/bind-qrcode [post]
func (h *WechatMPHandler) CreateBindQRCode(c *web.Context) error {
	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}

	resp, err := h.usecase.CreateBindQRCode(c.Request().Context(), user.ID)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Unbind 解除公众号绑定
//
//	@Summary		解除公众号绑定
//	@Description	解除当前用户与微信公众号 OpenID 的绑定关系
//	@Tags			【用户】微信公众号推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp	"成功"
//	@Failure		401	{object}	web.Resp	"未授权，用户未登录"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/wechat-mp/bind [delete]
func (h *WechatMPHandler) Unbind(c *web.Context) error {
	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}

	h.logger.InfoContext(c.Request().Context(), "wechat mp unbind: endpoint accessed", "user_id", user.ID)

	if err := h.usecase.Unbind(c.Request().Context(), user.ID); err != nil {
		return err
	}
	return c.Success(nil)
}
