package config

import (
	"log/slog"
	"testing"
	"time"
)

func TestRuntimeRelayDefaultsAndDisable(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://test")
	t.Setenv("MONKEYAI_RUNTIME_RELAY", "")
	t.Setenv("MONKEYAI_RUNTIME_SERVER_ID", "")
	t.Setenv("MONKEYAI_RUNTIME_SIGNING_KEY_FILE", "")
	t.Setenv("MONKEYAI_RUNTIME_FILES_ORIGIN", "")
	t.Setenv("MONKEYAI_RUNTIME_STATE_DIR", "")
	t.Setenv("MONKEYAI_PUBLIC_URL", "https://control.example.com/")
	cfg, err := Load(nil)
	if err != nil || !cfg.RuntimeRelay || cfg.RuntimeStateDir != "data/runtime" || cfg.RuntimeFilesOrigin != "https://control.example.com" {
		t.Fatalf("默认开启或身份配置回退异常: %+v %v", cfg, err)
	}
	t.Setenv("MONKEYAI_RUNTIME_RELAY", "false")
	cfg, err = Load(nil)
	if err != nil || cfg.RuntimeRelay {
		t.Fatalf("显式关闭未生效: %+v %v", cfg, err)
	}
	t.Setenv("MONKEYAI_RUNTIME_RELAY", "invalid")
	if _, err := Load(nil); err == nil {
		t.Fatal("不能接受无效开关")
	}
}

func TestRuntimeRelayConfigOverrides(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://test")
	t.Setenv("MONKEYAI_RUNTIME_RELAY", "true")
	t.Setenv("MONKEYAI_RUNTIME_STATE_DIR", "/runtime/state")
	t.Setenv("MONKEYAI_RUNTIME_SERVER_ID", "00000000-0000-4000-8000-000000000001")
	t.Setenv("MONKEYAI_RUNTIME_SIGNING_KEY_FILE", "/run/secrets/runtime.pem")
	t.Setenv("MONKEYAI_RUNTIME_FILES_ORIGIN", "https://files.example.com/")
	cfg, err := Load(nil)
	if err != nil || !cfg.RuntimeRelay || cfg.RuntimeServerID == "" || cfg.RuntimeStateDir != "/runtime/state" || cfg.RuntimeFilesOrigin != "https://files.example.com" {
		t.Fatalf("显式身份配置未生效: %+v %v", cfg, err)
	}
}

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

func TestLoadPublicURL(t *testing.T) {
	for _, test := range []struct {
		name string
		env  string
		args []string
		want string
	}{
		{name: "默认地址", want: "http://localhost:8080"},
		{name: "HTTPS 地址", env: " https://ai.example.com:8443/ ", want: "https://ai.example.com:8443"},
		{name: "公网 HTTP", env: "http://203.0.113.20:8080/", want: "http://203.0.113.20:8080"},
		{name: "内网 HTTP", env: "http://192.168.1.20:8080/", want: "http://192.168.1.20:8080"},
		{name: "内网 IPv6 HTTP", env: "http://[fd00::20]:8080/", want: "http://[fd00::20]:8080"},
		{name: "开发页面入口", env: "http://localhost:5173/", want: "http://localhost:5173"},
		{name: "命令行覆盖", env: "http://localhost:8080", args: []string{"-public-url=https://ai.example.com/"}, want: "https://ai.example.com"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("MONKEYAI_DATABASE_URL", "postgres://localhost/monkeyai")
			t.Setenv("MONKEYAI_PUBLIC_URL", test.env)
			cfg, err := Load(test.args)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.PublicURL != test.want {
				t.Fatalf("PublicURL = %q, want %q", cfg.PublicURL, test.want)
			}
		})
	}
}

func TestEndpointConnections(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://localhost/monkeyai")
	for _, value := range []string{"0", "-1", "many"} {
		t.Setenv("MONKEYAI_ENDPOINT_MAX_CONNECTIONS", value)
		if _, err := Load(nil); err == nil {
			t.Fatalf("接受了连接上限 %q", value)
		}
	}
	t.Setenv("MONKEYAI_ENDPOINT_MAX_CONNECTIONS", "25")
	cfg, err := Load(nil)
	if err != nil || cfg.EndpointMaxConnections != 25 {
		t.Fatalf("配置未生效: %+v %v", cfg, err)
	}
	cfg, err = Load([]string{"-endpoint-max-connections=10"})
	if err != nil || cfg.EndpointMaxConnections != 10 {
		t.Fatalf("命令行未覆盖: %+v %v", cfg, err)
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
