package captcha

import (
	"context"

	gocap "github.com/ackcoder/go-cap"
)

type Captcha struct {
	*gocap.Cap
}

func NewCaptcha() *Captcha {
	return &Captcha{
		Cap: gocap.New(
			gocap.WithChallenge(50, 32, 3),
			gocap.WithChallengeExpires(60*2),
			gocap.WithTokenExpires(60*5),
		),
	}
}

// Verify 验证验证码 token
func (c *Captcha) Verify(token string, solutions []int64) (bool, error) {
	_, err := c.Cap.RedeemChallenge(context.Background(), token, solutions)
	if err != nil {
		return false, err
	}
	return true, nil
}
