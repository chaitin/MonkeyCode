package firecracker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
)

type fakeHost struct {
	running   bool
	paused    bool
	failStart bool
	failStop  bool
	starts    int
	launch    Launch
}

func (h *fakeHost) Start(_ context.Context, l Launch) error {
	h.starts++
	h.launch = l
	if h.failStart {
		return errors.New("start failure")
	}
	h.running = true
	return nil
}
func (h *fakeHost) Running(context.Context, string) (bool, error) { return h.running, nil }
func (h *fakeHost) Stop(context.Context, string) error {
	if h.failStop {
		return errors.New("stop failure")
	}
	h.running = false
	h.paused = false
	return nil
}
func (h *fakeHost) Pause(context.Context, string) error { h.paused = true; return nil }
func (h *fakeHost) Remove(context.Context, string) error {
	if h.running {
		return errors.New("running")
	}
	return nil
}
func managerFixture(t *testing.T) (*Manager, *vmdisk.Manager, *fakeHost, Spec, string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	format := func(_ context.Context, path string, size int64) error {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			return err
		}
		return errors.Join(f.Truncate(size), f.Close())
	}
	disks, err := vmdisk.New(filepath.Join(root, "disks"))
	if err != nil {
		t.Fatal(err)
	}
	host := &fakeHost{}
	manager, err := NewManager(filepath.Join(root, "instances"), disks, host)
	if err != nil {
		t.Fatal(err)
	}
	spec := Spec{Disk: vmdisk.Spec{EnvironmentID: "env-1", InstanceID: "instance-1", TemplateID: "template-1", DiskBytes: 64 << 20}, VCPUs: 2, MemoryMiB: 512, Generation: 1}
	template := filepath.Join(root, "template.ext4")
	if err := format(context.Background(), template, spec.Disk.DiskBytes); err != nil {
		t.Fatal(err)
	}
	return manager, disks, host, spec, template
}
func TestPersistentVMLifecycle(t *testing.T) {
	m, disks, h, spec, template := managerFixture(t)
	ctx := t.Context()
	id := spec.Disk.EnvironmentID
	created, err := m.Create(ctx, spec, template)
	if err != nil {
		t.Fatal(err)
	}
	if replay, err := m.Create(ctx, spec, template); err != nil || replay != created {
		t.Fatal(replay, err)
	}
	running, err := m.Start(ctx, id, 1)
	if err != nil || running.Phase != "running" {
		t.Fatal(running, err)
	}
	if _, err := m.Start(ctx, id, 1); err != nil || h.starts != 1 {
		t.Fatal("启动不幂等", err, h.starts)
	}
	if _, err := m.Start(ctx, id, 2); err == nil {
		t.Fatal("运行中接受新启动")
	}
	if _, err := disks.Acquire(id, spec.Disk.InstanceID); err == nil {
		t.Fatal("运行中磁盘可被第二实例占用")
	}
	stopped, err := m.Stop(ctx, id, 2)
	if err != nil || stopped.Phase != "stopped" {
		t.Fatal(stopped, err)
	}
	if _, err := m.Start(ctx, id, 2); err == nil {
		t.Fatal("停止后同代次重启")
	}
	again, err := m.Start(ctx, id, 3)
	if err != nil || again.BootID == running.BootID {
		t.Fatal(again, err)
	}
	if _, err := m.Stop(ctx, id, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Retain(ctx, id, 5); err != nil {
		t.Fatal(err)
	}
	retained, err := disks.Load(id)
	if err != nil || retained.State != "retained" {
		t.Fatal(retained, err)
	}
	if _, err := m.Start(ctx, id, 6); err == nil {
		t.Fatal("删除后重新运行")
	}
}
func TestProtectionSurvivesRestartAndOldTargets(t *testing.T) {
	m, disks, h, spec, template := managerFixture(t)
	ctx := t.Context()
	id := spec.Disk.EnvironmentID
	if _, err := m.Create(ctx, spec, template); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(ctx, id, 1); err != nil {
		t.Fatal(err)
	}
	protected, err := m.Protect(ctx, id)
	if err != nil || protected.Phase != "paused" || !h.paused {
		t.Fatal(protected, err)
	}
	m, err = NewManager(m.root, disks, h)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(ctx, id, 100); err == nil {
		t.Fatal("重启后旧running目标绕过保护")
	}
	if err := m.ClearProtection(ctx, id, 2, func(context.Context) error { return nil }); err == nil {
		t.Fatal("未停止就解除保护")
	}
	if _, err := m.Stop(ctx, id, 2); err != nil {
		t.Fatal(err)
	}
	if err := m.ClearProtection(ctx, id, 3, func(context.Context) error { return errors.New("space low") }); err == nil {
		t.Fatal("未重新准入就解除保护")
	}
	if err := m.ClearProtection(ctx, id, 3, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Start(ctx, id, 3); err != nil {
		t.Fatal(err)
	}
}
func TestStartFailureKeepsLeaseUntilStop(t *testing.T) {
	m, disks, h, spec, template := managerFixture(t)
	ctx := t.Context()
	id := spec.Disk.EnvironmentID
	if _, err := m.Create(ctx, spec, template); err != nil {
		t.Fatal(err)
	}
	h.failStart = true
	if _, err := m.Start(ctx, id, 1); err == nil {
		t.Fatal("未拒绝启动失败")
	}
	if _, err := disks.Acquire(id, spec.Disk.InstanceID); err == nil {
		t.Fatal("未知启动结果释放了占用")
	}
	if _, err := m.Start(ctx, id, 2); err == nil {
		t.Fatal("失败后自动重启")
	}
	if _, err := m.Stop(ctx, id, 2); err != nil {
		t.Fatal(err)
	}
	h.failStart = false
	if _, err := m.Start(ctx, id, 3); err != nil {
		t.Fatal(err)
	}
	h.failStop = true
	if _, err := m.Stop(ctx, id, 4); err == nil {
		t.Fatal("停止失败仍成功")
	}
	if _, err := disks.Acquire(id, spec.Disk.InstanceID); err == nil {
		t.Fatal("停止失败释放了占用")
	}
}
