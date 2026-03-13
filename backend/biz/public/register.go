package public

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
)

// RegisterPublic 注册 public 模块
func RegisterPublic(i *do.Injector) error {
	w := do.MustInvoke[*web.Web](i)
	captchaSvc := do.MustInvoke[*captcha.Captcha](i)

	// 验证码路由
	v1 := w.Group("/api/v1/public")
	v1.GET("/captcha", web.BaseHandler(func(c *web.Context) error {
		return c.String(200, "captcha endpoint")
	}))
	_ = captchaSvc

	return nil
}
