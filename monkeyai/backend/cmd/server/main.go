package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/app"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
)

func main() {
	cfg, err := config.Load(os.Args[1:])
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		slog.Error("加载配置失败", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	application, err := app.New(ctx, cfg, logger)
	if err != nil {
		logger.Error("初始化服务失败", "error", err)
		os.Exit(1)
	}

	logger.Info("服务启动", "addr", cfg.Addr)
	if err := application.Run(ctx); err != nil {
		logger.Error("服务退出", "error", err)
		os.Exit(1)
	}
	logger.Info("服务已停止")
}
