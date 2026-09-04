package config

import (
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

type HTTP struct {
	Addr            string
	PprofAddr       string
	ShutdownTimeout time.Duration
}

type Database struct {
	URL string
}

type Config struct {
	HTTP
	Database
	LogLevel slog.Level
}

func Load(args []string) (Config, error) {
	addr := os.Getenv("MONKEYAI_HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	pprofAddr := os.Getenv("MONKEYAI_PPROF_ADDR")
	if pprofAddr == "" {
		pprofAddr = "127.0.0.1:6060"
	}

	shutdownTimeout := 10 * time.Second
	if value := os.Getenv("MONKEYAI_SHUTDOWN_TIMEOUT"); value != "" {
		parsed, err := time.ParseDuration(value)
		if err != nil {
			return Config{}, fmt.Errorf("解析 MONKEYAI_SHUTDOWN_TIMEOUT: %w", err)
		}
		shutdownTimeout = parsed
	}

	logLevel := os.Getenv("MONKEYAI_LOG_LEVEL")
	if logLevel == "" {
		logLevel = slog.LevelInfo.String()
	}

	cfg := Config{
		Addr:            addr,
		PprofAddr:       pprofAddr,
		ShutdownTimeout: shutdownTimeout,
		URL:             os.Getenv("MONKEYAI_DATABASE_URL"),
	}

	flags := flag.NewFlagSet("monkeyai-server", flag.ContinueOnError)
	flags.StringVar(&cfg.Addr, "http-addr", cfg.Addr, "HTTP 监听地址")
	flags.StringVar(&cfg.PprofAddr, "pprof-addr", cfg.PprofAddr, "pprof 监听地址")
	flags.DurationVar(&cfg.ShutdownTimeout, "shutdown-timeout", cfg.ShutdownTimeout, "优雅退出超时时间")
	flags.StringVar(&cfg.URL, "database-url", cfg.URL, "PostgreSQL 连接地址")
	flags.StringVar(&logLevel, "log-level", logLevel, "日志级别")
	if err := flags.Parse(args); err != nil {
		return Config{}, fmt.Errorf("解析启动参数: %w", err)
	}
	if flags.NArg() != 0 {
		return Config{}, fmt.Errorf("无法识别的启动参数: %s", strings.Join(flags.Args(), " "))
	}

	cfg.Addr = strings.TrimSpace(cfg.Addr)
	if cfg.Addr == "" {
		return Config{}, errors.New("HTTP 监听地址不能为空")
	}
	cfg.PprofAddr = strings.TrimSpace(cfg.PprofAddr)
	if cfg.PprofAddr == "" {
		return Config{}, errors.New("pprof 监听地址不能为空")
	}
	cfg.URL = strings.TrimSpace(cfg.URL)
	if cfg.URL == "" {
		return Config{}, errors.New("MONKEYAI_DATABASE_URL 或 -database-url 不能为空")
	}
	if cfg.ShutdownTimeout <= 0 {
		return Config{}, errors.New("优雅退出超时时间必须大于 0")
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(logLevel)); err != nil {
		return Config{}, fmt.Errorf("解析日志级别: %w", err)
	}

	return cfg, nil
}
