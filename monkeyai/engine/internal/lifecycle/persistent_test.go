package lifecycle

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestPersistentContainerResumesWithoutRecreation(t *testing.T) {
	driver := newFake()
	root, err := filepath.EvalSymlinks(privateDir(t))
	if err != nil {
		t.Fatal(err)
	}
	store := FileStore{Root: root}
	coordinator, _ := NewCoordinator(store, driver)
	spec := testSpec()
	spec.PersistentContainer = true
	if _, err := coordinator.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	spec.Generation++
	spec.DesiredState = DesiredStopped
	state, err := coordinator.Apply(t.Context(), spec)
	if err != nil || state.ProviderRef == "" || len(driver.instances) != 1 {
		t.Fatalf("停止未保留实例: %+v %v", state, err)
	}
	pins, err := store.Images()
	if err != nil || !pins[spec.Image] {
		t.Fatal("停止的持久容器镜像未被保护", pins, err)
	}
	coordinator, _ = NewCoordinator(store, driver)
	spec.Generation++
	spec.DesiredState = DesiredRunning
	state, err = coordinator.Apply(t.Context(), spec)
	if err != nil || state.Phase != PhaseRunning || state.ProviderRef != spec.InstanceID {
		t.Fatalf("重启后未恢复原容器: %+v %v", state, err)
	}
	creates := 0
	for _, operation := range driver.log {
		if operation == "create" {
			creates++
		}
		if operation == "remove" {
			t.Fatal("正常停止不应删除容器")
		}
	}
	if creates != 1 {
		t.Fatal("恢复重复创建了容器", driver.log)
	}
	spec.Generation++
	spec.DesiredState = DesiredDeleted
	state, err = coordinator.Apply(t.Context(), spec)
	if err != nil || state.ProviderRef != "" || len(driver.instances) != 0 {
		t.Fatalf("删除未清理容器: %+v %v", state, err)
	}
}

func TestMissingPersistentContainerRequiresExplicitDeletion(t *testing.T) {
	driver := newFake()
	coordinator, _ := NewCoordinator(FileStore{Root: privateDir(t)}, driver)
	spec := testSpec()
	spec.PersistentContainer = true
	if _, err := coordinator.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	delete(driver.instances, spec.InstanceID)
	spec.Generation++
	spec.DesiredState = DesiredStopped
	if state, err := coordinator.Apply(t.Context(), spec); err == nil || state.Phase != PhaseFailed {
		t.Fatal("容器丢失被视为正常停止", state, err)
	}
	spec.Generation++
	spec.DesiredState = DesiredDeleted
	if state, err := coordinator.Apply(t.Context(), spec); err != nil || state.Phase != PhaseDeleted {
		t.Fatal("显式删除无法清理丢失容器的记录", state, err)
	}
}

func TestPersistentContainerRejectsReplacementAndDowngrade(t *testing.T) {
	driver := newFake()
	coordinator, _ := NewCoordinator(FileStore{Root: privateDir(t)}, driver)
	spec := testSpec()
	spec.PersistentContainer = true
	if _, err := coordinator.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	spec.Generation++
	spec.DesiredState = DesiredStopped
	if _, err := coordinator.Apply(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	next := spec
	next.Generation++
	next.DesiredState = DesiredRunning
	next.InstanceID = "replacement"
	if _, err := coordinator.Apply(t.Context(), next); !errors.Is(err, ErrInstanceConflict) {
		t.Fatal("允许替换持久容器", err)
	}
	next = spec
	next.Generation++
	next.PersistentContainer = false
	if _, err := coordinator.Apply(t.Context(), next); !errors.Is(err, ErrGenerationConflict) {
		t.Fatal("允许降级为停止即删除", err)
	}
}
