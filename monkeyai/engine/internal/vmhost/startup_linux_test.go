//go:build linux

package vmhost

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func TestRealImageStartup(t *testing.T) {
	if os.Getenv("MONKEYAI_VM_STARTUP_TEST") != "1" {
		t.Skip("仅在授权KVM宿主上使用独立目录显式验证真实镜像启动")
	}
	root := os.Getenv("MONKEYAI_VM_STARTUP_ROOT")
	template := os.Getenv("MONKEYAI_VM_STARTUP_TEMPLATE")
	if !filepath.IsAbs(root) || root == "/" || !filepath.IsAbs(template) || os.Geteuid() != 0 {
		t.Fatal("需要Linux root、独立绝对目录和已转换模板")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(root, "test-bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	wrapper := "#!/usr/bin/python3\nimport os,sys\nargs=sys.argv[1:]\nif any(arg.startswith('--unit=monkeyai-fc-') for arg in args): args=['--property=StandardOutput=journal' if arg=='--property=StandardOutput=null' else arg for arg in args]\nos.execv('/usr/bin/systemd-run',['systemd-run']+args)\n"
	if err := os.WriteFile(filepath.Join(bin, "systemd-run"), []byte(wrapper), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	var cfg struct {
		Server, HostID string
		Insecure       bool
		Firecracker    json.RawMessage
	}
	configFile := os.Getenv("MONKEYAI_VM_STARTUP_CONFIG")
	if configFile == "" {
		configFile = "/etc/monkeyai-engine/config.json"
	}
	raw, err := os.ReadFile(configFile)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]json.RawMessage
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(stored["server"], &cfg.Server) != nil || json.Unmarshal(stored["host_id"], &cfg.HostID) != nil {
		t.Fatal("宿主配置缺少身份")
	}
	_ = json.Unmarshal(stored["insecure"], &cfg.Insecure)
	cfg.Firecracker = stored["firecracker"]
	var settings Config
	if err := json.Unmarshal(cfg.Firecracker, &settings); err != nil {
		t.Fatal(err)
	}
	settings.GuestPool, settings.LinkPool = "10.222.0.0/16", "10.223.0.0/16"
	raw, _ = json.Marshal(settings)
	if _, err := os.Stat("/var/lib/monkeyai-engine/control/identity.key"); err != nil {
		t.Fatal(err)
	}
	key, err := control.Key("/var/lib/monkeyai-engine/control/identity.key")
	if err != nil {
		t.Fatal(err)
	}
	client, err := control.New(cfg.Server, key)
	if err != nil {
		t.Fatal(err)
	}
	client.WithInsecure(cfg.Insecure)
	driver, err := New(filepath.Join(root, "vm-data"), filepath.Join(root, "vm-state"), raw, client, cfg.HostID)
	if err != nil {
		t.Fatal(err)
	}
	defer driver.Close()
	raw, err = os.ReadFile(os.Getenv("MONKEYAI_VM_STARTUP_SPEC"))
	if err != nil {
		t.Fatal(err)
	}
	var spec lifecycle.Spec
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	id := func() string {
		var b [16]byte
		if _, err := rand.Read(b[:]); err != nil {
			t.Fatal(err)
		}
		return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
	}
	spec.EnvironmentID, spec.InstanceID, spec.Generation = id(), id(), 1
	spec.ImageDigest = os.Getenv("MONKEYAI_VM_STARTUP_DIGEST")
	if spec.ImageDigest == "" {
		t.Fatal("必须固定兼容镜像摘要")
	}
	image := strings.Split(spec.Image, "@")[0]
	if colon := strings.LastIndexByte(image, ':'); colon > strings.LastIndexByte(image, '/') {
		image = image[:colon]
	}
	spec.Image = image + "@" + spec.ImageDigest
	spec.DesiredState = lifecycle.DesiredRunning
	if err := spec.Validate(); err != nil {
		t.Fatal(err)
	}
	disks, manager, host, err := driver.stores(spec)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Minute)
	defer cancel()
	state, err := manager.Create(ctx, driver.nativeSpec(spec, strings.TrimPrefix(spec.ImageDigest, "sha256:")), template)
	if err != nil {
		t.Fatal(err)
	}
	disk, err := disks.Load(spec.EnvironmentID)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Dir(disk.Path))
	if err != nil || len(entries) != 1 || entries[0].Name() != "disk.ext4" {
		t.Fatal("真实环境没有使用单块持久盘", entries, err)
	}
	info, err := os.Stat(disk.Path)
	if err != nil || info.Size() != spec.VirtualMachine.DiskBytes {
		t.Fatal("磁盘总容量与冻结规格不一致", err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 40*time.Second)
		defer stop()
		if _, err := manager.Stop(cleanup, spec.EnvironmentID, spec.Generation); err != nil {
			t.Errorf("测试实例停止未确认: %v", err)
			return
		}
		if err := host.Remove(cleanup, state.ID); err != nil {
			t.Errorf("测试网络回收未确认: %v", err)
		}
	})
	if err := driver.Start(ctx, spec, state.ID); err != nil {
		t.Fatal(err)
	}
	status, err := driver.Status(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	version, err := driver.RuntimeVersion(ctx, spec)
	if err != nil {
		t.Fatal(err)
	}
	if spec.RuntimePackage != nil && version != spec.RuntimePackage.Version {
		t.Fatal("runtime未切换到固定版本", version)
	}
	t.Logf("真实镜像启动通过：environment=%s instance=%s runtime=%s authenticated=%v", spec.EnvironmentID, spec.InstanceID, version, status.Authorized)
	if err := driver.Stop(ctx, spec, state.ID); err != nil {
		t.Fatal(err)
	}
	spec.Generation++
	if err := driver.Start(ctx, spec, state.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := driver.Status(ctx, spec); err != nil {
		t.Fatal(err)
	}
	if current, err := driver.RuntimeVersion(ctx, spec); err != nil || current != version {
		t.Fatal("停止重启后runtime未保留", current, err)
	}
	t.Logf("原实例与单盘冷启动复用通过：instance=%s runtime=%s", spec.InstanceID, version)
}
