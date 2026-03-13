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
	"github.com/chaitin/MonkeyCode/backend/pkg/store"
)

// RegisterInfra 注册基础设施依赖
func RegisterInfra(i *do.Injector) error {
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
	do.Provide(i, func(i *do.Injector) (*web.Web, error) {
		return web.New(), nil
	})

	// Captcha
	do.Provide(i, func(i *do.Injector) (*captcha.Captcha, error) {
		return captcha.NewCaptcha(), nil
	})

	// Email SMTP Client
	do.Provide(i, func(i *do.Injector) (*email.SMTPClient, error) {
		cfg := do.MustInvoke[*config.Config](i)
		return email.NewSMTPClient(email.SMTPConfig{
			Host:     cfg.SMTP.Host,
			Port:     cfg.SMTP.Port,
			Username: cfg.SMTP.Username,
			Password: cfg.SMTP.Password,
			From:     cfg.SMTP.From,
		}), nil
	})

	// Auth Middleware - 简化版本，避免循环依赖
	do.Provide(i, func(i *do.Injector) (*middleware.AuthMiddleware, error) {
		cfg := do.MustInvoke[*config.Config](i)
		l := do.MustInvoke[*slog.Logger](i)
		redisCli := do.MustInvoke[*redis.Client](i)
		return middleware.NewAuthMiddleware(cfg, nil, l, redisCli), nil
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
