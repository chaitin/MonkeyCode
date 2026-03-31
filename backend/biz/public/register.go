package public

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/public/handler/http/v1"
)

// ProvidePublic 注册 public 模块的服务工厂
func ProvidePublic(i *do.Injector) {
	do.Provide(i, v1.NewCaptchaHandler)
}

// InvokePublic 触发 public 模块的 handler 初始化
func InvokePublic(i *do.Injector) {
	do.MustInvoke[*v1.CaptchaHandler](i)
}
