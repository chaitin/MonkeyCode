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
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/email"
	"github.com/chaitin/MonkeyCode/backend/pkg/llm"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/template"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
	"github.com/chaitin/MonkeyCode/backend/pkg/store"
	"github.com/chaitin/MonkeyCode/backend/pkg/tasker"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/ws"
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

	// VM Expire Queue
	do.Provide(i, func(i *do.Injector) (*delayqueue.VMExpireQueue, error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		return delayqueue.NewVMExpireQueue(r, l), nil
	})

	do.Provide(i, func(i *do.Injector) (taskflow.Clienter, error) {
		cfg := do.MustInvoke[*config.Config](i)
		l := do.MustInvoke[*slog.Logger](i)
		return taskflow.NewClient(taskflow.WithDebug(cfg.Debug), taskflow.WithLogger(l)), nil
	})

	// Tasker（任务状态机）
	do.Provide(i, func(i *do.Injector) (*tasker.Tasker[*domain.TaskSession], error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		return tasker.NewTasker(r, tasker.WithLogger[*domain.TaskSession](l)), nil
	})

	// LLM Client
	do.Provide(i, func(i *do.Injector) (*llm.Client, error) {
		cfg := do.MustInvoke[*config.Config](i)
		return llm.NewClient(llm.Config{
			BaseURL:       cfg.LLM.BaseURL,
			APIKey:        cfg.LLM.APIKey,
			Model:         cfg.LLM.Model,
			InterfaceType: llm.InterfaceType(cfg.LLM.InterfaceType),
		}), nil
	})

	// Loki Client
	do.Provide(i, func(i *do.Injector) (*loki.Client, error) {
		cfg := do.MustInvoke[*config.Config](i)
		return loki.NewClient(cfg.Loki.Addr), nil
	})

	// TaskSummary Queue
	do.Provide(i, func(i *do.Injector) (*delayqueue.TaskSummaryQueue, error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		return delayqueue.NewTaskSummaryQueue(r, l), nil
	})

	// Channel Registry（通知渠道）
	do.Provide(i, func(i *do.Injector) (*channel.Registry, error) {
		return channel.NewRegistry(
			channel.NewDingTalkSender(),
			channel.NewFeishuSender(),
			channel.NewWeComSender(),
			channel.NewWebhookSender(),
		), nil
	})

	// Template Registry（通知模板）
	do.Provide(i, func(i *do.Injector) (*template.Registry, error) {
		return template.NewDefaultRegistry(), nil
	})

	// Dispatcher（通知分发器）
	do.Provide(i, func(i *do.Injector) (*dispatcher.Dispatcher, error) {
		r := do.MustInvoke[*redis.Client](i)
		channelRepo := do.MustInvoke[domain.NotifyChannelRepo](i)
		sendLogRepo := do.MustInvoke[domain.NotifySendLogRepo](i)
		senderReg := do.MustInvoke[*channel.Registry](i)
		templateReg := do.MustInvoke[*template.Registry](i)
		l := do.MustInvoke[*slog.Logger](i)

		return dispatcher.NewDispatcher(r, channelRepo, sendLogRepo, senderReg, templateReg, nil, l), nil
	})

	// WebSocket TaskConn
	do.Provide(i, func(i *do.Injector) (*ws.TaskConn, error) {
		return ws.NewTaskConn(), nil
	})

	return nil
}
