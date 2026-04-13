package backend

import (
	"github.com/GoYoko/web"
	"github.com/GoYoko/web/locale"
	"github.com/labstack/echo/v4"
	"github.com/samber/do"
	"golang.org/x/text/language"

	"github.com/chaitin/MonkeyCode/backend/biz"
	hostrepo "github.com/chaitin/MonkeyCode/backend/biz/host/repo"
	hostusecase "github.com/chaitin/MonkeyCode/backend/biz/host/usecase"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
	"github.com/chaitin/MonkeyCode/backend/pkg/tasker"
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

// WithModelHook 注入模型列表扩展回调
func WithModelHook(hook domain.ModelHook) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, hook)
	}
}

// WithTasker 注入外部 Tasker 实例
func WithTasker(t *tasker.Tasker[*domain.TaskSession]) BridgeOption {
	return func(i *do.Injector) {
		do.OverrideValue(i, t)
	}
}

// WithInternalHook 注入内部 handler 回调（用于 taskflow 回调中与 task 系统耦合的逻辑）
func WithInternalHook(hook domain.InternalHook) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, hook)
	}
}

// WithTaskHook 注入任务模块回调
func WithTaskHook(hook domain.TaskHook) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, hook)
	}
}

// WithProjectHook 注入项目模块回调
func WithProjectHook(hook domain.ProjectHook) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, hook)
	}
}

// WithTeamHook 注入团队成员变更回调
func WithTeamHook(hook domain.TeamHook) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, hook)
	}
}

// WithSiteResolver 注入站点解析器
func WithSiteResolver(resolver domain.SiteResolver) BridgeOption {
	return func(i *do.Injector) {
		do.ProvideValue(i, resolver)
	}
}

func WithCaptcha(captcha *captcha.Captcha) BridgeOption {
	return func(i *do.Injector) {
		do.OverrideValue(i, captcha)
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
	l := locale.NewLocalizerWithFile(language.Chinese, errcode.LocalFS, []string{"locale.zh.toml", "locale.en.toml"})
	w.SetLocale(l)

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
