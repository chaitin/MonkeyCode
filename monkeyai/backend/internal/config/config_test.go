package config

import (
	"log/slog"
	"testing"
	"time"
)

func TestLoad(t *testing.T) {
	t.Setenv("MONKEYAI_HTTP_ADDR", "")
	t.Setenv("MONKEYAI_PPROF_ADDR", "")
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://monkeyai:secret@localhost:5432/monkeyai")
	t.Setenv("MONKEYAI_SHUTDOWN_TIMEOUT", "")
	t.Setenv("MONKEYAI_LOG_LEVEL", "")

	cfg, err := Load([]string{
		"-http-addr=127.0.0.1:9000",
		"-pprof-addr=127.0.0.1:6061",
		"-shutdown-timeout=3s",
		"-log-level=debug",
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:9000" {
		t.Fatalf("Addr = %q", cfg.Addr)
	}
	if cfg.PprofAddr != "127.0.0.1:6061" {
		t.Fatalf("PprofAddr = %q", cfg.PprofAddr)
	}
	if cfg.ShutdownTimeout != 3*time.Second {
		t.Fatalf("ShutdownTimeout = %s", cfg.ShutdownTimeout)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Fatalf("LogLevel = %s", cfg.LogLevel)
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("MONKEYAI_PPROF_ADDR", "")
	t.Setenv("MONKEYAI_DATABASE_URL", "")

	if _, err := Load(nil); err == nil {
		t.Fatal("期望数据库地址为空时返回错误")
	}
}

func TestLoadRejectsInvalidShutdownTimeout(t *testing.T) {
	t.Setenv("MONKEYAI_PPROF_ADDR", "")
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://localhost/monkeyai")
	t.Setenv("MONKEYAI_SHUTDOWN_TIMEOUT", "later")

	if _, err := Load(nil); err == nil {
		t.Fatal("期望退出超时时间非法时返回错误")
	}
}

func TestLoadRequiresPprofAddr(t *testing.T) {
	t.Setenv("MONKEYAI_PPROF_ADDR", " ")
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://localhost/monkeyai")

	if _, err := Load(nil); err == nil {
		t.Fatal("期望 pprof 监听地址为空时返回错误")
	}
}

func TestLoadRejectsInvalidPublicURL(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://localhost/monkeyai")
	t.Setenv("MONKEYAI_PUBLIC_URL", "javascript:alert(1)")

	if _, err := Load(nil); err == nil {
		t.Fatal("期望公网地址非法时返回错误")
	}
}

func TestLoadRequiresPublicAndAdminURLOnSameHost(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://localhost/monkeyai")
	t.Setenv("MONKEYAI_PUBLIC_URL", "https://api.example.com")
	t.Setenv("MONKEYAI_ADMIN_URL", "https://admin.example.com")

	if _, err := Load(nil); err == nil {
		t.Fatal("期望公网地址与管理端地址主机名不同时返回错误")
	}
}

func TestLoadRejectsIncompleteInitialAdmin(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://localhost/monkeyai")
	t.Setenv("MONKEYAI_PUBLIC_URL", "http://localhost:8080")
	t.Setenv("MONKEYAI_INITIAL_ADMIN_EMAIL", "admin@example.com")
	t.Setenv("MONKEYAI_INITIAL_ADMIN_PASSWORD", "")

	if _, err := Load(nil); err == nil {
		t.Fatal("期望首次管理员配置不完整时返回错误")
	}
}
