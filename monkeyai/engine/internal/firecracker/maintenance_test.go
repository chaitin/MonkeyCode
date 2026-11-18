package firecracker

import "testing"

func TestMaintenanceBootRequiresConfirmedStopAndFreshLease(t *testing.T) {
	manager, _, host, spec, template := managerFixture(t)
	if _, err := manager.Create(t.Context(), spec, template); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Maintain(t.Context(), spec.Disk.EnvironmentID, spec.Generation); err == nil {
		t.Fatal("尚未确认停止就维护启动")
	}
	if _, err := manager.Stop(t.Context(), spec.Disk.EnvironmentID, spec.Generation); err != nil {
		t.Fatal(err)
	}
	state, err := manager.Maintain(t.Context(), spec.Disk.EnvironmentID, spec.Generation)
	if err != nil || state.Phase != "maintenance" || !host.launch.Maintenance || state.Lease == "" {
		t.Fatal(state, host.launch, err)
	}
	if _, err := manager.Start(t.Context(), spec.Disk.EnvironmentID, spec.Generation+1); err == nil {
		t.Fatal("维护虚拟机被当成用户启动")
	}
	if _, err := manager.Protect(t.Context(), spec.Disk.EnvironmentID); err != nil {
		t.Fatal(err)
	}
	if !host.paused {
		t.Fatal("维护启动绕过磁盘保护")
	}
}
func TestCPUStatRejectsMissingDuplicateAndMalformedCounts(t *testing.T) {
	for _, text := range []string{"system_usec 5\n", "usage_usec -1\n", "usage_usec 1\nusage_usec 2\n", "usage_usec 2 extra\n"} {
		if _, err := parseCPU(text); err == nil {
			t.Fatal(text)
		}
	}
	if value, err := parseCPU("system_usec 5\nusage_usec 125\n"); err != nil || value != 125 {
		t.Fatal(value, err)
	}
}
