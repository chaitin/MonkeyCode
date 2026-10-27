package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultLogLevel = slog.LevelWarn

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
	Design
	RuntimeDesktopOrigins        []string
	RuntimeRelay                 bool
	RuntimeStateDir              string
	RuntimeServerID              string
	RuntimeVerificationKeysFile  string
	RuntimeSigningKeyFile        string
	RuntimePreviewOriginTemplate string
	RuntimeFilesOrigin           string
	PublicURL                    string
	EndpointMaxConnections       int
	InitialAdminName             string
	InitialAdminEmail            string
	InitialAdminPassword         string
	LogLevel                     slog.Level
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
		logLevel = defaultLogLevel.String()
	}

	endpointMax, err := strconv.Atoi(envOr("MONKEYAI_ENDPOINT_MAX_CONNECTIONS", "1000"))
	if err != nil {
		return Config{}, fmt.Errorf("解析端点连接上限: %w", err)
	}
	runtimeRelay, err := strconv.ParseBool(envOr("MONKEYAI_RUNTIME_RELAY", "true"))
	if err != nil {
		return Config{}, fmt.Errorf("解析远程执行开关: %w", err)
	}
	cfg := Config{
		Design:                       loadDesign(),
		RuntimeDesktopOrigins:        strings.FieldsFunc(os.Getenv("MONKEYAI_RUNTIME_DESKTOP_ORIGINS"), func(r rune) bool { return r == ',' || r == ' ' }),
		RuntimeRelay:                 runtimeRelay,
		RuntimeStateDir:              envOr("MONKEYAI_RUNTIME_STATE_DIR", "data/runtime"),
		RuntimeServerID:              os.Getenv("MONKEYAI_RUNTIME_SERVER_ID"),
		RuntimeVerificationKeysFile:  os.Getenv("MONKEYAI_RUNTIME_VERIFICATION_KEYS_FILE"),
		RuntimeSigningKeyFile:        os.Getenv("MONKEYAI_RUNTIME_SIGNING_KEY_FILE"),
		RuntimePreviewOriginTemplate: os.Getenv("MONKEYAI_RUNTIME_PREVIEW_ORIGIN_TEMPLATE"),
		RuntimeFilesOrigin:           os.Getenv("MONKEYAI_RUNTIME_FILES_ORIGIN"),
		Addr:                         addr,
		EndpointMaxConnections:       endpointMax,
		PprofAddr:                    pprofAddr,
		ShutdownTimeout:              shutdownTimeout,
		URL:                          os.Getenv("MONKEYAI_DATABASE_URL"),
		PublicURL:                    envOr("MONKEYAI_PUBLIC_URL", "http://localhost:8080"),
		InitialAdminName:             envOr("MONKEYAI_INITIAL_ADMIN_NAME", "MonkeyAI Admin"),
		InitialAdminEmail:            strings.TrimSpace(os.Getenv("MONKEYAI_INITIAL_ADMIN_EMAIL")),
		InitialAdminPassword:         os.Getenv("MONKEYAI_INITIAL_ADMIN_PASSWORD"),
	}

	if err := parseFlags(args, &cfg, &logLevel); err != nil {
		return Config{}, fmt.Errorf("解析启动参数: %w", err)
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
	parsed, err := url.Parse(cfg.PublicURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		if err != nil {
			slog.Warn("操作失败", "module", "config", "operation", "Load", "error", err)
		}
		return Config{}, errors.New("public-url 必须是无凭据、查询或片段的绝对 HTTP(S) 地址")
	}
	if (cfg.InitialAdminEmail == "") != (cfg.InitialAdminPassword == "") {
		return Config{}, errors.New("首次管理员邮箱和密码必须同时配置")
	}
	if cfg.InitialAdminPassword != "" && len(cfg.InitialAdminPassword) < 12 {
		return Config{}, errors.New("首次管理员密码不能少于 12 个字符")
	}
	cfg.RuntimeFilesOrigin = strings.TrimRight(strings.TrimSpace(cfg.RuntimeFilesOrigin), "/")
	if cfg.RuntimeFilesOrigin == "" {
		cfg.RuntimeFilesOrigin = cfg.PublicURL
	}
	if cfg.EndpointMaxConnections < 1 {
		return Config{}, errors.New("端点连接上限必须大于 0")
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
