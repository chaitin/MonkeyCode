package public

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/public/handler/http/v1"
)

func RegisterPublic(i *do.Injector) {
	do.Provide(i, v1.NewCaptchaHandler)
	do.MustInvoke[*v1.CaptchaHandler](i)
}
