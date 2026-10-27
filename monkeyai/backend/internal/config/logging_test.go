package config

import (
	"log/slog"
	"testing"
)

func TestRemovedDedupSettingsAreIgnored(t *testing.T) {
	for _, name := range []string{"MONKEYAI_LOG_DEDUP_ENABLED", "MONKEYAI_LOG_DEDUP_WINDOW", "MONKEYAI_LOG_DEDUP_MAX_KEYS"} {
		t.Setenv(name, "obsolete")
	}
	level, err := ParseLogLevel([]string{"--log-level=error"})
	if err != nil || level != slog.LevelError {
		t.Fatalf("日志级别解析失败: %v %v", level, err)
	}
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://unused")
	if _, err := Load(nil); err != nil {
		t.Fatal(err)
	}
}
