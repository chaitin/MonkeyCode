package config

import (
	"bytes"
	"errors"
	"flag"
	"log/slog"
	"strings"
	"testing"
)

func TestLogLevelDefaultsAndOverrides(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://test")
	for _, test := range []struct {
		name string
		env  string
		args []string
		want slog.Level
	}{
		{name: "默认 WARN", want: slog.LevelWarn},
		{name: "环境 INFO", env: "info", want: slog.LevelInfo},
		{name: "环境 DEBUG", env: "debug", want: slog.LevelDebug},
		{name: "参数覆盖环境", env: "error", args: []string{"--log-level=info"}, want: slog.LevelInfo},
		{name: "参数覆盖非法环境", env: "invalid", args: []string{"--log-level=debug"}, want: slog.LevelDebug},
		{name: "显式 WARN", env: "info", args: []string{"--log-level=warn"}, want: slog.LevelWarn},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("MONKEYAI_LOG_LEVEL", test.env)
			level, err := ParseLogLevel(test.args)
			if err != nil || level != test.want {
				t.Fatalf("日志构造级别 = %s，期望 %s: %v", level, test.want, err)
			}
			cfg, err := Load(test.args)
			if err != nil || cfg.LogLevel != test.want {
				t.Fatalf("业务配置级别 = %s，期望 %s: %v", cfg.LogLevel, test.want, err)
			}
		})
	}
}

func TestParseLogLevelWithoutBusinessConfiguration(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "")
	t.Setenv("MONKEYAI_SHUTDOWN_TIMEOUT", "invalid")
	t.Setenv("MONKEYAI_LOG_LEVEL", "warn")
	for _, test := range []struct {
		args []string
		want slog.Level
	}{
		{nil, slog.LevelWarn},
		{[]string{"--log-level", "debug", "--http-addr", ":9090"}, slog.LevelDebug},
		{[]string{"--database-url", "--log-level=debug"}, slog.LevelWarn},
		{[]string{"--log-level=error"}, slog.LevelError},
	} {
		level, err := ParseLogLevel(test.args)
		if err != nil || level != test.want {
			t.Fatalf("%v: %v %v", test.args, level, err)
		}
	}
	if _, err := ParseLogLevel([]string{"--help"}); !errors.Is(err, flag.ErrHelp) {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"--log-level=private-secret"}, {"--unknown=private-secret"}, {"private-secret"}, {"--shutdown-timeout=private-secret"}} {
		_, err := ParseLogLevel(args)
		if err == nil || strings.Contains(err.Error(), "private-secret") {
			t.Fatalf("unsafe error: %v", err)
		}
	}
}

func TestHelpDoesNotIncludeEnvironmentSecrets(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://private-secret")
	t.Setenv("MONKEYAI_LOG_LEVEL", "error")
	var output bytes.Buffer
	PrintUsage(&output)
	if strings.Contains(output.String(), "private-secret") || !strings.Contains(output.String(), "-log-level") || !strings.Contains(output.String(), `(default "WARN")`) {
		t.Fatal(output.String())
	}
}
