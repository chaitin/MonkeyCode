package v1

import (
	"log/slog"
	"net/http"

	"github.com/GoYoko/web"
	gocap "github.com/ackcoder/go-cap"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
)

type CaptchaHandler struct {
	cap    *captcha.Captcha
	logger *slog.Logger
}

func NewCaptchaHandler(i *do.Injector) (*CaptchaHandler, error) {
	w := do.MustInvoke[*web.Web](i)

	c := &CaptchaHandler{
		cap:    do.MustInvoke[*captcha.Captcha](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "CaptchaHandler"),
	}

	v1 := w.Group("/api/v1/public/captcha")
	v1.POST("/challenge", web.BaseHandler(c.CreateCaptcha))
	v1.POST("/redeem", web.BindHandler(c.RedeemCaptcha))

	return c, nil
}

// CreateCaptcha
//
//	@Summary		CreateCaptcha
//	@Description	CreateCaptcha
//	@Tags			【验证码】
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	gocap.ChallengeData
//	@Router			/api/v1/public/captcha/challenge [post]
func (h *CaptchaHandler) CreateCaptcha(c *web.Context) error {
	data, err := h.cap.CreateChallenge(c.Request().Context())
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "create captcha failed", "error", err)
		return errcode.ErrCreateCaptchaFailed.Wrap(err)
	}
	return c.JSON(http.StatusCreated, data)
}

// RedeemCaptcha
//
//	@Summary		RedeemCaptcha
//	@Description	RedeemCaptcha
//	@Tags			【验证码】
//	@Accept			json
//	@Produce		json
//	@Param			body	body		domain.RedeemCaptchaReq	true	"request"
//	@Success		200		{object}	gocap.VerificationResult
//	@Router			/api/v1/public/captcha/redeem [post]
func (h *CaptchaHandler) RedeemCaptcha(c *web.Context, req domain.RedeemCaptchaReq) error {
	h.logger.InfoContext(c.Request().Context(), "redeem captcha", "req", req)

	data, err := h.cap.RedeemChallenge(c.Request().Context(), req.Token, req.Solutions)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, gocap.VerificationResult{
			Success: false,
			Message: err.Error(),
		})
	}
	return c.JSON(http.StatusCreated, gocap.VerificationResult{
		Success:   true,
		TokenData: data,
	})
}
