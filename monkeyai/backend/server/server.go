package server

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/app"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InstanceIdentity 可由传给 Run 的宿主扩展实现，提供持久化的部署身份。
// 读取失败仅禁用设计资源签发，不影响应用启动。
type InstanceIdentity = app.InstanceIdentity

type MemberWriters func(*pgxpool.Pool) (member.UserWriter, member.GroupWriter, error)
type AdminRegistrar interface {
	RegisterAdmin(chi.Router)
}

// ParseLogLevel reads only shared startup flags, before business initialization.
func ParseLogLevel(args []string) (slog.Level, error) { return config.ParseLogLevel(args) }

func ParseLogging(args []string) (slog.Level, logging.Settings, error) {
	return config.ParseLogging(args)
}

// PrintUsage writes startup help without reading environment secrets.
func PrintUsage(output io.Writer) { config.PrintUsage(output) }

func Run(ctx context.Context, args []string, logger *slog.Logger, factory MemberWriters, registrars ...AdminRegistrar) error {
	if logger == nil {
		return errors.New("日志实例不可为空")
	}
	slog.SetDefault(logger)
	if factory == nil {
		return errors.New("成员写入工厂不可为空")
	}
	cfg, err := config.Load(args)
	if err != nil {
		return err
	}
	appRegistrars := make([]app.AdminRegistrar, 0, len(registrars))
	for _, registrar := range registrars {
		appRegistrars = append(appRegistrars, registrar)
	}
	application, err := app.NewWithMembers(ctx, cfg, logger, app.MemberWriters(factory), appRegistrars...)
	if err != nil {
		return err
	}
	logger.Info("服务启动", "addr", cfg.Addr, "pprof_addr", cfg.PprofAddr)
	if err := application.Run(ctx); err != nil {
		return err
	}
	logger.Info("服务已停止")
	return nil
}
