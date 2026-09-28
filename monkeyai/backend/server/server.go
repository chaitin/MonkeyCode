package server

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/app"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MemberWriters func(*pgxpool.Pool) (member.UserWriter, member.GroupWriter, error)

func Run(ctx context.Context, args []string, factory MemberWriters) error {
	if factory == nil {
		return errors.New("私有版成员实现不可为空")
	}
	cfg, err := config.Load(args)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	application, err := app.NewWithMembers(ctx, cfg, logger, app.MemberWriters(factory))
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
