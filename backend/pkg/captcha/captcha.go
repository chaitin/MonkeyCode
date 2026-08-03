package captcha

import (
	"context"

	gocap "github.com/ackcoder/go-cap"
)

type Captcha struct {
	*gocap.Cap
	enabled bool
}

func NewCaptcha(enabled ...bool) *Captcha {
	captchaEnabled := true
	if len(enabled) > 0 {
		captchaEnabled = enabled[0]
	}
	return &Captcha{
		Cap: gocap.New(
			gocap.WithChallenge(50, 32, 3),
			gocap.WithChallengeExpires(60*2),
			gocap.WithTokenExpires(60*5),
		),
		enabled: captchaEnabled,
	}
}

func (c *Captcha) SetEnabled(enabled bool) {
	c.enabled = enabled
}

func (c *Captcha) ValidateToken(ctx context.Context, token string) bool {
	return !c.enabled || c.Cap.ValidateToken(ctx, token)
}

// Verify 验证验证码 token
func (c *Captcha) Verify(token string, solutions []int64) (bool, error) {
	_, err := c.Cap.RedeemChallenge(context.Background(), token, solutions)
	if err != nil {
		return false, err
	}
	return true, nil
}
