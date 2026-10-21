package config

import (
	"errors"
	"flag"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestParseLoggingSettings(t *testing.T) {
	t.Setenv("MONKEYAI_LOG_DEDUP_ENABLED", "true")
	t.Setenv("MONKEYAI_LOG_DEDUP_WINDOW", "60s")
	t.Setenv("MONKEYAI_LOG_DEDUP_MAX_KEYS", "4096")
	level, settings, err := ParseLogging([]string{"--log-level=error"})
	if err != nil || level != slog.LevelError || !settings.Enabled || settings.Window != time.Minute || settings.MaxKeys != 4096 {
		t.Fatalf("日志设置错误: %+v %v", settings, err)
	}
	for _, test := range []struct{ key, value string }{
		{"MONKEYAI_LOG_DEDUP_ENABLED", "private-secret"},
		{"MONKEYAI_LOG_DEDUP_WINDOW", "private-secret"},
		{"MONKEYAI_LOG_DEDUP_WINDOW", "0s"},
		{"MONKEYAI_LOG_DEDUP_WINDOW", "601s"},
		{"MONKEYAI_LOG_DEDUP_MAX_KEYS", "private-secret"},
		{"MONKEYAI_LOG_DEDUP_MAX_KEYS", "127"},
		{"MONKEYAI_LOG_DEDUP_MAX_KEYS", "65537"},
	} {
		t.Run(test.key+test.value, func(t *testing.T) {
			t.Setenv(test.key, test.value)
			_, _, err := ParseLogging(nil)
			if err == nil || strings.Contains(err.Error(), "private-secret") {
				t.Fatalf("无效设置未安全拒绝: %v", err)
			}
			_, _, err = ParseLogging([]string{"--help"})
			if !errors.Is(err, flag.ErrHelp) {
				t.Fatal("帮助被无效配置阻断", err)
			}
		})
	}
}
func TestBusinessConfigDoesNotReadInjectedLoggerSettings(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://unused")
	t.Setenv("MONKEYAI_LOG_DEDUP_WINDOW", "private-secret")
	if _, err := Load(nil); err != nil {
		t.Fatal("嵌入服务读取了调用方的日志构造配置", err)
	}
}
