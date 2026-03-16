package pkg

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
	"github.com/chaitin/MonkeyCode/backend/pkg/email"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
	"github.com/chaitin/MonkeyCode/backend/pkg/store"
)

// RegisterInfra 注册基础设施依赖
func RegisterInfra(i *do.Injector, w ...*web.Web) error {
	// Logger
	do.Provide(i, func(i *do.Injector) (*slog.Logger, error) {
		cfg := do.MustInvoke[*config.Config](i)
		return logger.NewLogger(cfg.Logger), nil
	})

	// Redis
	do.Provide(i, func(i *do.Injector) (*redis.Client, error) {
		cfg := do.MustInvoke[*config.Config](i)
		return store.NewRedisCli(cfg), nil
	})

	// Ent DB
	do.Provide(i, func(i *do.Injector) (*db.Client, error) {
		cfg := do.MustInvoke[*config.Config](i)
		l := do.MustInvoke[*slog.Logger](i)
		return store.NewEntDBV2(cfg, l)
	})

	// Web
	if len(w) > 0 && w[0] != nil {
		do.ProvideValue(i, w[0])
	} else {
		do.Provide(i, func(i *do.Injector) (*web.Web, error) {
			return web.New(), nil
		})
	}

	// Captcha
	do.Provide(i, func(i *do.Injector) (*captcha.Captcha, error) {
		return captcha.NewCaptcha(), nil
	})

	// Email Sender（默认 SMTP 实现，内部项目可通过 do.ProvideValue 覆盖）
	do.Provide(i, func(i *do.Injector) (domain.EmailSender, error) {
		cfg := do.MustInvoke[*config.Config](i)
		return email.NewSMTPClient(email.SMTPConfig{
			Host:     cfg.SMTP.Host,
			Port:     cfg.SMTP.Port,
			Username: cfg.SMTP.Username,
			Password: cfg.SMTP.Password,
			From:     cfg.SMTP.From,
		}), nil
	})

	// Session
	do.Provide(i, func(i *do.Injector) (*session.Session, error) {
		cfg := do.MustInvoke[*config.Config](i)
		return session.New(cfg), nil
	})

	// Auth Middleware
	do.Provide(i, func(i *do.Injector) (*middleware.AuthMiddleware, error) {
		sess := do.MustInvoke[*session.Session](i)
		l := do.MustInvoke[*slog.Logger](i)
		return middleware.NewAuthMiddleware(sess, nil, l), nil
	})

	// Audit Middleware
	do.Provide(i, func(i *do.Injector) (*middleware.AuditMiddleware, error) {
		l := do.MustInvoke[*slog.Logger](i)
		auditUc := do.MustInvoke[domain.AuditUsecase](i)
		userUc := do.MustInvoke[domain.UserUsecase](i)
		return middleware.NewAuditMiddleware(l, auditUc, userUc), nil
	})

	return nil
}
