package driver

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

func TestDockerIntegration(t *testing.T) {
	image := os.Getenv("MONKEYAI_DOCKER_TEST_IMAGE")
	if image == "" {
		t.Skip("只在一次性 Docker-in-Docker 测试容器运行")
	}
	if _, err := os.Stat("/monkeyai-docker-test"); err != nil {
		t.Fatal("缺少隔离测试标记")
	}
	root := t.TempDir()
	store, err := storage.New(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	d, err := New(dockerapi.Socket, filepath.Join(root, "instances"), store)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	s := sample()
	s.EnvironmentID = fmt.Sprintf("test-%d", time.Now().UnixNano())
	s.Image = image
	s.ImageDigest = image[len(image)-71:]
	s.NetworkPolicy = "public-only"
	if os.Getenv("MONKEYAI_DOCKER_RUNTIME_TEST") == "1" {
		s.Runtime = &lifecycle.Runtime{Server: "https://example.com", ServerID: "server", UserID: "user"}
	}
	ctx := t.Context()
	if err = d.Prepare(ctx, s); err != nil {
		t.Fatal(err)
	}
	ref, err := d.Create(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		clean, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := d.Stop(clean, s, ref); err != nil {
			t.Error(err)
		}
		if err := d.Remove(clean, s, ref); err != nil {
			t.Error(err)
		}
	})
	if err = d.Start(ctx, s, ref); err != nil {
		var c container
		_ = d.client.Do(ctx, "GET", "/containers/"+ref+"/json", nil, &c)
		i, _ := d.image(ctx, s)
		m, _ := store.Ensure(ctx, s)
		t.Logf("actual=%+v want=%+v", c, build(s, i, m, filepath.Join(d.instanceDir(s), "resolv.conf")))
		t.Fatal(err)
	}
	got, err := d.Inspect(ctx, s, ref)
	if err != nil || got.Phase != lifecycle.InstanceRunning {
		t.Fatal(got, err)
	}
	t.Log("Docker + gVisor 容器实际启动，身份、只读根、资源配置与独立网络检查通过")
	if out, err := exec.CommandContext(ctx, "docker", "exec", ref, "sh", "-c", "echo preserved > /workspace/preserved; echo home > /home/monkey/preserved").CombinedOutput(); err != nil {
		t.Fatalf("持久目录写入失败：%v %s", err, out)
	}
	if s.Runtime != nil {
		status, e := d.Status(ctx, s)
		if e != nil || !status.Valid() {
			t.Fatal("runtime 状态", status, e)
		}
		called := false
		if e = d.Login(ctx, s, func(code string) error { called = code == "TEST-CODE"; return nil }); e != nil || !called {
			t.Fatal("runtime 授权", e)
		}
		if e = d.Serve(ctx, s, false); e != nil {
			t.Fatal("runtime 服务启动", e)
		}
		if e = d.Serve(ctx, s, true); e != nil {
			t.Fatal("runtime 服务恢复观察", e)
		}
		t.Log("Docker exec 状态、设备授权事件及持久服务观察通过")
	}

	if err = d.Stop(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	if err = d.Remove(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	if err = d.Remove(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	s.InstanceID = "rebuilt"
	s.Generation++
	if ref, err = d.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	if err = d.Start(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.CommandContext(ctx, "docker", "exec", ref, "sh", "-c", "test \"$(cat /workspace/preserved)\" = preserved && test \"$(cat /home/monkey/preserved)\" = home").CombinedOutput(); err != nil {
		t.Fatalf("重建后持久目录未保留：%v %s", err, out)
	}
	t.Log("停止、删除实例后重建，项目及用户目录数据保留")
}
