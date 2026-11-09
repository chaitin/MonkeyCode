package driver

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/runtimeupdate"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

func TestPersistentDockerRuntimeIntegration(t *testing.T) {
	image, resources := os.Getenv("MONKEYAI_PERSISTENCE_TEST_IMAGE"), os.Getenv("MONKEYAI_RUNTIME_TEST_RESOURCES")
	if image == "" || resources == "" {
		t.Skip("需要一次性 Docker-in-Docker 及真实 runtime 发行资源")
	}
	if _, err := os.Stat("/monkeyai-docker-test"); err != nil {
		t.Fatal("缺少隔离测试标记")
	}
	root := t.TempDir()
	volumes, err := storage.New(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	driver, err := New(dockerapi.Socket, filepath.Join(root, "instances"), volumes)
	if err != nil {
		t.Fatal(err)
	}
	defer driver.Close()
	folder := filepath.Join(resources, "26.1105.2", runtime.GOARCH)
	raw, err := os.ReadFile(filepath.Join(folder, "manifest.json"))
	var release lifecycle.RuntimePackage
	if err != nil || json.Unmarshal(raw, &release) != nil {
		t.Fatal("发行资源无效", err)
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		name := filepath.Base(request.URL.Path)
		if _, ok := release.Files[name]; !ok {
			http.NotFound(w, request)
			return
		}
		http.ServeFile(w, request, filepath.Join(folder, name))
	}))
	defer server.Close()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	client, _ := control.New(server.URL, key)
	client.WithInsecure(true)
	manager := func(ctx context.Context, spec lifecycle.Spec) *runtimeupdate.Manager {
		mounts, err := volumes.Ensure(ctx, spec)
		if err != nil {
			t.Fatal(err)
		}
		for _, mount := range mounts {
			if mount.Target == "/var/lib/monkeyai" {
				return runtimeupdate.New(mount.Source, client).WithPreparer(func(ctx context.Context, payload, destination string, release lifecycle.RuntimePackage, reuse []string) (lifecycle.RuntimePackage, error) {
					return driver.PrepareRuntime(ctx, spec, payload, destination, release, reuse)
				})
			}
		}
		t.Fatal("缺少 runtime 持久目录")
		return nil
	}
	driver.WithRuntimeSource(func(ctx context.Context, spec lifecycle.Spec) (standalone.Files, error) {
		return manager(ctx, spec).Current()
	})
	driver.WithRuntimeUpdater(func(ctx context.Context, spec lifecycle.Spec) error {
		return manager(ctx, spec).Update(ctx, *spec.RuntimePackage)
	})
	spec := sample()
	spec.EnvironmentID = fmt.Sprintf("persist-%d", time.Now().UnixNano())
	spec.InstanceID = fmt.Sprintf("container-%d", time.Now().UnixNano())
	spec.Image, spec.ImageDigest = image, image[len(image)-71:]
	spec.PersistentContainer, spec.NetworkPolicy = true, "public-only"
	spec.Runtime = &lifecycle.Runtime{Server: "https://example.com", ServerID: "server", UserID: "user"}
	store := lifecycle.FileStore{Root: filepath.Join(root, "states")}
	coordinator, _ := lifecycle.NewCoordinator(store, driver)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = driver.Stop(ctx, spec, spec.InstanceID)
		_ = driver.Remove(ctx, spec, spec.InstanceID)
	})
	state, err := coordinator.Apply(t.Context(), spec)
	if err != nil {
		t.Fatal(err)
	}
	container, err := driver.load(t.Context(), spec, state.ProviderRef)
	if err != nil {
		t.Fatal(err)
	}
	original := container.ID
	if output, err := exec.Command("docker", "exec", "--user", "0", original, "sh", "-c", "printf preserved > /etc/monkeyai-persistence-check").CombinedOutput(); err != nil {
		t.Fatal(err, string(output))
	}
	_ = exec.Command("docker", "exec", original, standalone.Binary, "login", "--device-code", "--state-dir", standalone.StateDir, "--server", "https://127.0.0.1:1").Run()
	before, err := driver.Status(t.Context(), spec)
	if err != nil || !before.Valid() {
		t.Fatal("runtime 初始化", before, err)
	}
	spec.Generation++
	spec.DesiredState = lifecycle.DesiredStopped
	if _, err := coordinator.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	spec.Generation++
	spec.RuntimePackage = &release
	if _, err := coordinator.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	if err := driver.UpdateRuntime(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	coordinator, _ = lifecycle.NewCoordinator(store, driver)
	spec.Generation++
	spec.DesiredState = lifecycle.DesiredRunning
	if _, err := coordinator.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	container, err = driver.load(t.Context(), spec, state.ProviderRef)
	if err != nil || container.ID != original {
		t.Fatal("更新或重新启动重建了容器", container.ID, original, err)
	}
	if output, err := exec.Command("docker", "exec", original, "cat", "/etc/monkeyai-persistence-check").CombinedOutput(); err != nil || string(output) != "preserved" {
		t.Fatal("系统层修改丢失", string(output), err)
	}
	after, err := driver.Status(t.Context(), spec)
	if err != nil || after.MachineID != before.MachineID || after.PublicKey != before.PublicKey {
		t.Fatal("runtime 更新改变设备身份", after, before, err)
	}
	selected, err := driver.runtimeFiles(t.Context(), spec)
	if err != nil || selected.Version != release.Version || selected.Binary == standalone.Binary {
		t.Fatal("没有切换独立 runtime", selected, err)
	}
	t.Log("真实 Docker/gVisor 保留容器、系统层、runtime 身份及独立版本切换通过")
}
