package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/app"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/server"
)

func main() {
	os.Exit(mainCode())
}

func mainCode() int {
	if len(os.Args) > 1 && os.Args[1] == "reset" {
		if err := server.Reset(context.Background(), os.Args[2:], os.Stdin, os.Stdout); err != nil {
			_, _ = fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	level, err := config.ParseLogLevel(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		config.PrintUsage(os.Stdout)
		return 0
	}
	if err != nil {
		if _, err := os.Stderr.WriteString("启动参数无效，请使用 --help 查看用法\n"); err != nil {
			slog.Error("写入输出失败", "module", "main", "operation", "mainCode", "error", err)
		}
		return 2
	}
	logger := logging.New(os.Stdout, level)
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
