package worker

import (
	"reflect"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func TestHostTargetUsesServerURLOnlyForCurrentServer(t *testing.T) {
	original := target(t)
	original.NetworkPolicy = "public-only"
	original.Image = "control.example/environments/image@" + original.ImageDigest
	original.Runtime = &lifecycle.Runtime{Server: "https://control.example", ServerID: "server-a", UserID: "user-a"}
	cfg := control.Config{Server: "https://control.example"}
	unchanged, err := hostTarget(original, cfg)
	if err != nil || !reflect.DeepEqual(unchanged, original) {
		t.Fatal("默认地址改变了环境规格", err)
	}
	cfg.ServerURL = "http://127.0.0.1:8080/"
	got, err := hostTarget(original, cfg)
	if err != nil {
		t.Fatal(err)
	}
	want := original
	want.Image = "127.0.0.1:8080/environments/image@" + original.ImageDigest
	want.Runtime = &lifecycle.Runtime{Server: "http://127.0.0.1:8080", ServerID: "server-a", UserID: "user-a"}
	if !reflect.DeepEqual(got, want) || original.Runtime.Server != cfg.Server {
		t.Fatal("未保持环境身份、镜像摘要或原始规格", got)
	}
	original.Image = "registry.example/environments/image@" + original.ImageDigest
	original.Runtime = &lifecycle.Runtime{Server: "https://other.example", ServerID: "other", UserID: "user-a"}
	got, err = hostTarget(original, cfg)
	if err != nil || !reflect.DeepEqual(got, original) {
		t.Fatal("改写了其他服务的地址", got, err)
	}
}
