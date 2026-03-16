package backend

import (
	"github.com/GoYoko/web"
	"github.com/labstack/echo/v4"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg"
)

// BridgeOption 桥接可选配置
type BridgeOption func(*do.Injector)

// WithEmailSender 注入自定义邮件发送实现，覆盖默认 SMTP
func WithEmailSender(sender domain.EmailSender) BridgeOption {
	return func(i *do.Injector) {
		do.OverrideValue(i, sender)
	}
}

func Register(e *echo.Echo, dir string, opts ...BridgeOption) error {
	cfg, err := config.Init(dir)
	if err != nil {
		return err
	}

	injector := do.New()
	do.ProvideValue(injector, cfg)

	w := web.NewFromEcho(e)

	// 注册 infra
	if err := pkg.RegisterInfra(injector, w); err != nil {
		return err
	}

	// 应用可选配置（如自定义 EmailSender）
	for _, opt := range opts {
		opt(injector)
	}

	return biz.RegisterAll(injector)
}
