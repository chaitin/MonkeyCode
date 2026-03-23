package pkg

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/email"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
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
		return logger.NewLogger(&cfg.Logger), nil
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

	do.Provide(i, email.NewSMTPClient)

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

	// VM Idle Sleep Queue
	do.Provide(i, func(i *do.Injector) (*delayqueue.VMSleepQueue, error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		return delayqueue.NewVMSleepQueue(r, l), nil
	})

	// VM Idle Notify Queue
	do.Provide(i, func(i *do.Injector) (*delayqueue.VMNotifyQueue, error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		return delayqueue.NewVMNotifyQueue(r, l), nil
	})

	// VM Idle Recycle Queue
	do.Provide(i, func(i *do.Injector) (*delayqueue.VMRecycleQueue, error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		return delayqueue.NewVMRecycleQueue(r, l), nil
	})

	// VM Expire Queue（手动创建的 VM 过期队列）
	do.Provide(i, func(i *do.Injector) (*delayqueue.VMExpireQueue, error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		return delayqueue.NewVMExpireQueue(r, l), nil
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
		return dispatcher.NewDispatcher(i, nil), nil
	})

	// WebSocket TaskConn
	do.Provide(i, func(i *do.Injector) (*ws.TaskConn, error) {
		return ws.NewTaskConn(), nil
	})

	// 任务生命周期管理
	do.Provide(i, func(i *do.Injector) (*lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata], error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)

		lc := lifecycle.NewManager(
			r,
			lifecycle.WithLogger[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata](l),
			lifecycle.WithTransitions[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata](lifecycle.TaskTransitions()),
		)

		lc.Register(
			lifecycle.NewTaskCreateHook(i, lc),
			lifecycle.NewTaskNotifyHook(i),
		)

		return lc, nil
	})

	do.Provide(i, func(i *do.Injector) (*lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata], error) {
		r := do.MustInvoke[*redis.Client](i)
		l := do.MustInvoke[*slog.Logger](i)
		lc := lifecycle.NewManager(
			r,
			lifecycle.WithLogger[string, lifecycle.VMState, lifecycle.VMMetadata](l),
			lifecycle.WithTransitions[string, lifecycle.VMState, lifecycle.VMMetadata](lifecycle.VMTransitions()),
		)

		lc.Register(
			lifecycle.NewVMNotifyHook(i),
		)

		return lc, nil
	})

	return nil
}
