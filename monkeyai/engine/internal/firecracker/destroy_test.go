package firecracker

import "testing"

func TestDestroyRequiresRetainedDisksAndIndependentConfirmation(t *testing.T) {
	manager, disks, _, spec, template := managerFixture(t)
	if _, err := manager.Create(t.Context(), spec, template); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Destroy(t.Context(), spec.Disks.EnvironmentID, true); err == nil {
		t.Fatal("未删除实例允许销毁")
	}
	if _, err := manager.Stop(t.Context(), spec.Disks.EnvironmentID, spec.Generation); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Retain(t.Context(), spec.Disks.EnvironmentID, spec.Generation+1); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Destroy(t.Context(), spec.Disks.EnvironmentID, false); err == nil {
		t.Fatal("没有独立确认仍销毁")
	}
	if record, err := disks.Load(spec.Disks.EnvironmentID); err != nil || record.State != "retained" {
		t.Fatal("普通删除未保留双盘", record, err)
	}
	if state, err := manager.Destroy(t.Context(), spec.Disks.EnvironmentID, true); err != nil || state.Phase != "destroyed" {
		t.Fatal(state, err)
	}
	if state, err := manager.Destroy(t.Context(), spec.Disks.EnvironmentID, true); err != nil || state.Phase != "destroyed" {
		t.Fatal("销毁重放失败", state, err)
	}
}
