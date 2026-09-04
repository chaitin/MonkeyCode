package config

import (
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/url"
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
	PublicURL            string
	AdminURL             string
	InitialAdminName     string
	InitialAdminEmail    string
	InitialAdminPassword string
	LogLevel             slog.Level
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
		Addr:                 addr,
		PprofAddr:            pprofAddr,
		ShutdownTimeout:      shutdownTimeout,
		URL:                  os.Getenv("MONKEYAI_DATABASE_URL"),
		PublicURL:            envOr("MONKEYAI_PUBLIC_URL", "http://localhost:8080"),
		AdminURL:             envOr("MONKEYAI_ADMIN_URL", "http://localhost:5173"),
		InitialAdminName:     envOr("MONKEYAI_INITIAL_ADMIN_NAME", "MonkeyAI Admin"),
		InitialAdminEmail:    strings.TrimSpace(os.Getenv("MONKEYAI_INITIAL_ADMIN_EMAIL")),
		InitialAdminPassword: os.Getenv("MONKEYAI_INITIAL_ADMIN_PASSWORD"),
	}

	flags := flag.NewFlagSet("monkeyai-server", flag.ContinueOnError)
	flags.StringVar(&cfg.Addr, "http-addr", cfg.Addr, "HTTP 监听地址")
	flags.StringVar(&cfg.PprofAddr, "pprof-addr", cfg.PprofAddr, "pprof 监听地址")
	flags.DurationVar(&cfg.ShutdownTimeout, "shutdown-timeout", cfg.ShutdownTimeout, "优雅退出超时时间")
	flags.StringVar(&cfg.URL, "database-url", cfg.URL, "PostgreSQL 连接地址")
	flags.StringVar(&cfg.PublicURL, "public-url", cfg.PublicURL, "服务端公网地址")
	flags.StringVar(&cfg.AdminURL, "admin-url", cfg.AdminURL, "管理端页面地址")
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
	cfg.PublicURL = strings.TrimRight(strings.TrimSpace(cfg.PublicURL), "/")
	if cfg.PublicURL == "" {
		return Config{}, errors.New("服务端公网地址不能为空")
	}
	cfg.AdminURL = strings.TrimRight(strings.TrimSpace(cfg.AdminURL), "/")
	if cfg.AdminURL == "" {
		return Config{}, errors.New("管理端页面地址不能为空")
	}
	urls := make(map[string]*url.URL, 2)
	for name, value := range map[string]string{"public-url": cfg.PublicURL, "admin-url": cfg.AdminURL} {
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return Config{}, fmt.Errorf("%s 必须是绝对 HTTP(S) 地址", name)
		}
		urls[name] = parsed
	}
	if urls["public-url"].Scheme != urls["admin-url"].Scheme ||
		!strings.EqualFold(urls["public-url"].Hostname(), urls["admin-url"].Hostname()) {
		return Config{}, errors.New("public-url 与 admin-url 必须使用相同协议和主机名")
	}
	if (cfg.InitialAdminEmail == "") != (cfg.InitialAdminPassword == "") {
		return Config{}, errors.New("首次管理员邮箱和密码必须同时配置")
	}
	if cfg.InitialAdminPassword != "" && len(cfg.InitialAdminPassword) < 12 {
		return Config{}, errors.New("首次管理员密码不能少于 12 个字符")
	}
	if cfg.ShutdownTimeout <= 0 {
		return Config{}, errors.New("优雅退出超时时间必须大于 0")
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(logLevel)); err != nil {
		return Config{}, fmt.Errorf("解析日志级别: %w", err)
	}

	return cfg, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
