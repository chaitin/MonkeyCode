package driver

import (
	"slices"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func TestPersistentRootAndDevelopmentEnvironment(t *testing.T) {
	spec := sample()
	spec.PersistentContainer = true
	spec.Runtime = &lifecycle.Runtime{Server: "https://example.com", ServerID: "server", UserID: "user"}
	var image imageInfo
	image.Config.Env = []string{"GOROOT=/usr/local/go", "GOPROXY=https://goproxy.cn,direct", "GOTMPDIR=/workspace", "LD_PRELOAD=/evil", "MONKEYAI_ACCESS_TOKEN=secret"}
	body := build(spec, image, mounts(), "/data/resolv.conf")
	if body.HostConfig.ReadonlyRootfs || body.User != "1000:1000" || body.HostConfig.Privileged {
		t.Fatal("持久容器应开放根文件系统写入，但保留执行身份及权限限制", body)
	}
	for _, value := range []string{"GOROOT=/usr/local/go", "GOPROXY=https://goproxy.cn,direct", "GOTMPDIR=/workspace", "LD_PRELOAD=", "MONKEYAI_ACCESS_TOKEN="} {
		if !slices.Contains(body.Env, value) {
			t.Fatal("开发环境或凭据过滤不符合要求", value, body.Env)
		}
	}
	legacy := spec
	legacy.PersistentContainer = false
	if fingerprint(legacy) != fingerprint(spec) {
		t.Fatal("接管旧容器不应改变既有归属指纹")
	}
}
