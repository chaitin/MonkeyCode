package config

import (
	"errors"
	"flag"
	"io"
	"log/slog"
	"time"
)

func startupFlags(cfg *Config, level *string) *flag.FlagSet {
	flags := flag.NewFlagSet("monkeyai-server", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.IntVar(&cfg.EndpointMaxConnections, "endpoint-max-connections", cfg.EndpointMaxConnections, "端点连接总上限（含等待握手）")
	flags.StringVar(&cfg.Addr, "http-addr", cfg.Addr, "HTTP 监听地址")
	flags.StringVar(&cfg.PprofAddr, "pprof-addr", cfg.PprofAddr, "pprof 监听地址")
	flags.DurationVar(&cfg.ShutdownTimeout, "shutdown-timeout", cfg.ShutdownTimeout, "优雅退出超时时间")
	flags.StringVar(&cfg.URL, "database-url", cfg.URL, "PostgreSQL 连接地址")
	flags.StringVar(&cfg.PublicURL, "public-url", cfg.PublicURL, "统一对外访问地址")
	flags.StringVar(level, "log-level", *level, "日志级别")
	return flags
}

func parseFlags(args []string, cfg *Config, level *string) error {
	flags := startupFlags(cfg, level)
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return flag.ErrHelp
		}
		return errors.New("启动参数无效，请使用 --help 查看用法")
	}
	if flags.NArg() != 0 {
		return errors.New("无法识别的启动参数，请使用 --help 查看用法")
	}
	return nil
}

// ParseLogLevel parses shared startup flags without loading business settings.
func ParseLogLevel(args []string) (slog.Level, error) {
	var cfg Config
	text := envOr("MONKEYAI_LOG_LEVEL", defaultLogLevel.String())
	if err := parseFlags(args, &cfg, &text); err != nil {
		return 0, err
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(text)); err != nil {
		slog.Warn("操作失败", "module", "config", "operation", "ParseLogLevel", "error", err)
		return 0, errors.New("日志级别无效")
	}
	return level, nil
}

// PrintUsage uses static defaults, never secrets from the current environment.
func PrintUsage(output io.Writer) {
	cfg := Config{HTTP: HTTP{Addr: ":8080", PprofAddr: "127.0.0.1:6060", ShutdownTimeout: 10 * time.Second},
		EndpointMaxConnections: 1000, PublicURL: "http://localhost:8080"}
	level := defaultLogLevel.String()
	flags := startupFlags(&cfg, &level)
	flags.SetOutput(output)
	if _, err := io.WriteString(output, "用法: monkeyai-server [启动参数]\n      monkeyai-server reset [--database-url PostgreSQL连接地址]\n\nreset: 重置 admin@baizhi.cloud 的密码；未找到时提示填写管理员邮箱，成功后输出账号密码。\n\n启动参数:\n"); err != nil {
		slog.Error("写入输出失败", "module", "config", "operation", "PrintUsage", "error", err)
	}
	flags.PrintDefaults()
}
