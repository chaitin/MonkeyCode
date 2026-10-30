package driver

import (
	"context"
	"encoding/json"
	"github.com/containerd/containerd/v2/core/containers"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	containerd "github.com/containerd/containerd/v2/client"
	"github.com/containerd/containerd/v2/core/content"
	"github.com/containerd/containerd/v2/core/images"
	"github.com/containerd/containerd/v2/pkg/namespaces"
	"github.com/opencontainers/go-digest"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
)

func linuxProbe(t *testing.T) {
	t.Helper()
	if os.Getenv("MONKEYAI_TEST_LIMITS") != "1" {
		t.Skip("仅在独立可销毁 Linux 容器中运行")
	}
	raw, err := os.ReadFile("/monkeyai-limits-test")
	if err != nil || string(raw) != "isolated\n" {
		t.Fatal("缺少测试容器标记")
	}
}
func TestLinuxSandboxTaskLimit(t *testing.T) {
	linuxProbe(t)
	root := t.TempDir()
	os.Chmod(root, 0755)
	rootfs := filepath.Join(root, "rootfs")
	os.Mkdir(rootfs, 0755)
	raw, err := os.ReadFile("/tmp/nproc")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rootfs, "nproc"), raw, 0755); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{"workspace", "home", "home/monkey", "etc", "proc", "dev", "sys", "tmp", "run"} {
		if err := os.MkdirAll(filepath.Join(rootfs, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	o := buildSpec(sample(), ocispec.Image{Config: ocispec.ImageConfig{Entrypoint: []string{"/nproc"}}}, nil)
	// 使用同一个 OCI 生成入口，仅降低测试阈值；不测试宿主 cgroup。
	for i := range o.Process.Rlimits {
		if o.Process.Rlimits[i].Type == "RLIMIT_NPROC" {
			o.Process.Rlimits[i].Soft = 64
			o.Process.Rlimits[i].Hard = 64
		}
	}
	o.Linux.CgroupsPath = ""
	o.Linux.Resources = nil
	data, _ := json.Marshal(o)
	if err := os.WriteFile(filepath.Join(root, "config.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "/usr/local/bin/runsc", "--root="+filepath.Join(root, "runsc"), "delete", "--force", "nproc-probe").Run()
		if err := unix.Unmount(filepath.Join(root, "runsc", "null-netns"), 0); err != nil && err != unix.ENOENT && err != unix.EINVAL {
			t.Error("清理测试 netns", err)
		}
	})
	command := exec.CommandContext(t.Context(), "/usr/local/bin/runsc", "--root="+filepath.Join(root, "runsc"), "--platform=systrap", "--network=none", "--ignore-cgroups=true", "run", "--bundle="+root, "nproc-probe")
	output, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "NPROC_OK") {
		t.Fatalf("固定 gVisor 任务限制验证失败: %v\n%s", err, output)
	}
	t.Log(strings.TrimSpace(string(output)))
}

func TestLinuxCacheOwnershipAndPins(t *testing.T) {
	linuxProbe(t)
	testNamespace := "cache-probe-" + time.Now().Format("150405.000000000")
	ctx := namespaces.WithNamespace(t.Context(), testNamespace)
	client, err := containerd.New("/run/monkeyai-engine/containerd.sock")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	if err := client.NamespaceService().Create(ctx, testNamespace, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(namespaces.WithNamespace(context.Background(), testNamespace), 10*time.Second)
		defer cancel()
		list, err := client.ImageService().List(cleanup)
		if err != nil {
			t.Error(err)
			return
		}
		for _, i := range list {
			if err := client.ImageService().Delete(cleanup, i.Name, images.SynchronousDelete()); err != nil {
				t.Error(err)
			}
		}
		if err := client.NamespaceService().Delete(cleanup, testNamespace); err != nil {
			t.Error(err)
		}
	})
	root := t.TempDir()
	os.Chmod(root, 0700)
	d := &Driver{client: client, root: filepath.Join(root, "instances")}
	if err := os.Mkdir(d.root, 0700); err != nil {
		t.Fatal(err)
	}
	data := []byte("cache-test-blob")
	desc := ocispec.Descriptor{Digest: digest.FromBytes(data), Size: int64(len(data)), MediaType: "application/octet-stream"}
	if err := content.WriteBlob(ctx, client.ContentStore(), "cache-probe", strings.NewReader(string(data)), desc); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, name := range []string{"idle", "state", "container", "unknown"} {
		labels := map[string]string{}
		if name != "unknown" {
			labels = map[string]string{cacheOwner: "1", cacheUsed: now}
		}
		if _, err := client.ImageService().Create(ctx, images.Image{Name: name, Target: desc, Labels: labels}); err != nil {
			t.Fatal(err)
		}
	}
	state := sample()
	state.Image = "example.com/image@" + state.ImageDigest
	saved := lifecycle.State{Spec: state, Phase: lifecycle.PhaseFailed}
	// 状态文件使用规范镜像，元数据镜像以同一名称创建。
	if _, err := client.ImageService().Create(ctx, images.Image{Name: state.Image, Target: desc, Labels: map[string]string{cacheOwner: "1", cacheUsed: now}}); err != nil {
		t.Fatal(err)
	}
	if err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Save(state.EnvironmentID, saved); err != nil {
		t.Fatal(err)
	}
	c, err := client.NewContainer(ctx, "cache-pinned", func(_ context.Context, _ *containerd.Client, c *containers.Container) error {
		c.Image = "container"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Delete(ctx)
	store := imageCache{driver: d}
	list, err := store.Images(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, image := range list {
		protected := image.Name == "container" || image.Name == state.Image || image.Name == "unknown"
		err := store.Delete(ctx, image)
		if protected && err == nil {
			t.Fatal("删除了受保护镜像", image)
		}
		if !protected && err != nil {
			t.Fatal(err)
		}
	}
	if _, err := client.ContentStore().Info(ctx, desc.Digest); err != nil {
		t.Fatal("回收破坏了共享内容", err)
	}
	if _, err := cache.Disk(ctx, cache.Root); err != nil {
		t.Fatal(err)
	}
}
