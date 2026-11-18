package driver

import (
	"slices"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
)

func TestRuntimeProxyEnvironment(t *testing.T) {
	cfg := control.NetworkConfig{Proxy: "http://10.2.98.120:3128", NoProxy: "10.2.98.116"}
	d := (&Driver{}).WithNetwork(cfg)
	got := runtimeEnv([]string{"HTTP_PROXY=", "no_proxy=", "PATH=/usr/bin"}, d.proxyEnv, "/runtime/bin/runtime")
	want := []string{"PATH=/runtime/bin:/usr/bin", "HTTP_PROXY=" + cfg.Proxy, "http_proxy=" + cfg.Proxy, "HTTPS_PROXY=" + cfg.Proxy, "https_proxy=" + cfg.Proxy, "NO_PROXY=" + cfg.NoProxy, "no_proxy=" + cfg.NoProxy}
	if !slices.Equal(got, want) {
		t.Fatalf("运行时环境不符合预期：%v", got)
	}
}
