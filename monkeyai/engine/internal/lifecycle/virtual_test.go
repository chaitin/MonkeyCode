package lifecycle

import (
	"context"
	"strings"
	"testing"
)

func virtualSpec() Spec {
	s := testSpec()
	s.Driver = "firecracker"
	s.VirtualMachine = &VirtualMachine{Architecture: "amd64", BundleSHA256: strings.Repeat("a", 64), DiskBytes: 128 << 20}
	return s
}
func TestVirtualMachineStopRetainsOriginalInstance(t *testing.T) {
	driver := newFake()
	c, err := NewCoordinator(FileStore{Root: privateDir(t)}, driver)
	if err != nil {
		t.Fatal(err)
	}
	s := virtualSpec()
	if state, err := c.Apply(t.Context(), s); err != nil || state.Phase != PhaseRunning {
		t.Fatal(state, err)
	}
	s.Generation++
	s.DesiredState = DesiredStopped
	stopped, err := c.Apply(t.Context(), s)
	if err != nil || stopped.Phase != PhaseStopped || stopped.ProviderRef != "instance-1" {
		t.Fatal(stopped, err)
	}
	s.Generation++
	s.DesiredState = DesiredRunning
	if state, err := c.Apply(t.Context(), s); err != nil || state.ProviderRef != stopped.ProviderRef || state.Phase != PhaseRunning {
		t.Fatal(state, err)
	}
	count := map[string]int{}
	for _, op := range driver.log {
		count[op]++
	}
	if count["create"] != 1 || count["prepare"] != 1 || count["remove"] != 0 {
		t.Fatal("重启重建了原实例", driver.log)
	}
	s.Generation++
	s.DesiredState = DesiredStopped
	if _, err := c.Apply(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	s.Generation++
	s.DesiredState = DesiredRunning
	s.VirtualMachine.DiskBytes *= 2
	if _, err := c.Apply(t.Context(), s); err == nil {
		t.Fatal("允许原实例更改磁盘冻结规格")
	}
}
func TestVirtualMachineCannotMasqueradeAsContainer(t *testing.T) {
	s := virtualSpec()
	if err := s.Validate(); err != nil {
		t.Fatal(err)
	}
	s.PersistentContainer = true
	if err := s.Validate(); err == nil {
		t.Fatal("虚拟机允许容器标识")
	}
	s.PersistentContainer = false
	s.Driver = "gvisor"
	if err := s.Validate(); err == nil {
		t.Fatal("gVisor接受虚拟机规格")
	}
}

type cleanupDriver struct {
	*fakeDriver
	cleanupErr error
}

func (d cleanupDriver) FinalizeStop(context.Context, Spec, string) error { return d.cleanupErr }
func TestStoppedCleanupMustConfirmBeforeRecordingStopped(t *testing.T) {
	f := newFake()
	d := &cleanupDriver{fakeDriver: f}
	c, err := NewCoordinator(FileStore{Root: privateDir(t)}, d)
	if err != nil {
		t.Fatal(err)
	}
	s := virtualSpec()
	if _, err := c.Apply(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	d.cleanupErr = ErrInstanceConflict
	s.Generation++
	s.DesiredState = DesiredStopped
	state, err := c.Apply(t.Context(), s)
	if err == nil || state.Phase == PhaseStopped {
		t.Fatal("未清理完成却确认停止", state, err)
	}
}
