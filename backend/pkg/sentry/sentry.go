package sentry

import (
	"log/slog"
	"time"

	sentrygo "github.com/getsentry/sentry-go"
	sentryecho "github.com/getsentry/sentry-go/echo"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// Init 初始化Sentry
func Init(cfg *config.Config, logger *slog.Logger) error {
	if cfg.Sentry.DSN == "" {
		logger.Info("Sentry DSN not configured, skipping Sentry initialization")
		return nil
	}

	err := sentrygo.Init(sentrygo.ClientOptions{
		Dsn:         cfg.Sentry.DSN,
	})

	if err != nil {
		return err
	}

	logger.Info("Sentry initialized successfully")

	return nil
}

// Middleware 返回Echo的Sentry中间件
func Middleware() echo.MiddlewareFunc {
	return sentryecho.New(sentryecho.Options{
		Repanic: true,
		Timeout: 2 * time.Second,
	})
}

// CaptureError 捕获错误并发送到Sentry
func CaptureError(err error) {
	if err != nil {
		sentrygo.CaptureException(err)
	}
}

// CaptureMessage 捕获消息并发送到Sentry
func CaptureMessage(message string) {
	sentrygo.CaptureMessage(message)
}

// AddBreadcrumb 添加面包屑
func AddBreadcrumb(breadcrumb *sentrygo.Breadcrumb) {
	sentrygo.AddBreadcrumb(breadcrumb)
}

// ConfigureScope 配置作用域
func ConfigureScope(f func(scope *sentrygo.Scope)) {
	sentrygo.ConfigureScope(f)
}

// Flush 刷新Sentry缓冲区
func Flush(timeout time.Duration) bool {
	return sentrygo.Flush(timeout)
}