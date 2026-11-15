package preflight

import "testing"

func TestLocalSystemInfo(t *testing.T) {
	dir := t.TempDir()
	system, times := systemInfo(dir)
	if system == nil || system.Hostname == "" || system.OSName == "" || system.KernelVersion == "" || system.CPU == nil || system.CPU.LogicalCores < 1 || times.total == 0 || system.Memory == nil || system.Disk == nil || system.Disk.Path != dir || system.Disk.TotalBytes == 0 {
		t.Fatalf("Linux 宿主信息不完整: %+v", system)
	}
	missing, _ := systemInfo(dir + "/missing")
	if missing.Disk != nil || missing.Memory == nil || missing.CPU == nil {
		t.Fatal("单项磁盘采集失败不应丢弃其他指标")
	}
}
