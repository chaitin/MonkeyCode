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
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func main() {
	os.Exit(mainCode())
}

func mainCode() int {
	level, settings, err := config.ParseLogging(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		config.PrintUsage(os.Stdout)
		return 0
	}
	if err != nil {
		_, _ = os.Stderr.WriteString("启动参数无效，请使用 --help 查看用法\n")
		return 2
	}
	logs, err := logging.NewRuntime(os.Stdout, level, settings)
	if err != nil {
		_, _ = os.Stderr.WriteString("日志配置无效\n")
		return 2
	}
	defer logs.Close()
	logger := logs.Logger()
	slog.SetDefault(logger)
	if err := run(logger); err != nil {
		logger.Error("服务退出失败", "error", err)
		return 1
	}
	return 0
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load(os.Args[1:])
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	application, err := app.New(ctx, cfg, logger)
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
