package backend

import (
	"github.com/GoYoko/web"
	"github.com/labstack/echo/v4"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz"
	hostrepo "github.com/chaitin/MonkeyCode/backend/biz/host/repo"
	hostusecase "github.com/chaitin/MonkeyCode/backend/biz/host/usecase"
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

// WithPublicHost 启用公共主机支持，注册 PublicHostRepo 和 PublicHostUsecase
func WithPublicHost() BridgeOption {
	return func(i *do.Injector) {
		do.Provide(i, hostrepo.NewPublicHostRepo)
		do.Provide(i, hostusecase.NewPublicHostUsecase)
	}
}

// WithPrivilegeChecker 注入特权用户检查器
func WithPrivilegeChecker(checker domain.PrivilegeChecker) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, checker)
	}
}

// WithInternalHook 注入内部 handler 回调（用于 taskflow 回调中与 task 系统耦合的逻辑）
func WithInternalHook(hook domain.InternalHook) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, hook)
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
