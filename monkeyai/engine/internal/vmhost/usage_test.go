package vmhost

import (
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func TestUsageKeepsBootSamplesSeparate(t *testing.T) {
	before := firecracker.Sample{BootID: "boot1", At: time.Now(), CPUUsec: 1000000}
	after := before
	after.At = after.At.Add(2 * time.Second)
	after.CPUUsec += 3000000
	after.Memory = 123
	got := usage(after, before)
	if got.CPUCores == nil || *got.CPUCores != 1.5 || got.MemoryBytes == nil || *got.MemoryBytes != 123 {
		t.Fatal(got)
	}
	after.BootID = "boot2"
	if got := usage(after, before); got.CPUCores != nil {
		t.Fatal("不同启动累计CPU被相减", got)
	}
	after.BootID = before.BootID
	after.CPUUsec = 0
	if got := usage(after, before); got.CPUCores != nil {
		t.Fatal("计数下降被当成CPU用量", got)
	}
}
func TestFingerprintFreezesVMResourcesAndAllowsControlGeneration(t *testing.T) {
	s := lifecycle.Spec{EnvironmentID: "env", InstanceID: "instance", Generation: 1, DesiredState: lifecycle.DesiredRunning, Driver: "firecracker", VirtualMachine: &lifecycle.VirtualMachine{SystemBytes: 1 << 30, DataBytes: 1 << 30}}
	original := fingerprint(s)
	s.Generation = 2
	s.DesiredState = lifecycle.DesiredStopped
	if fingerprint(s) != original {
		t.Fatal("停止控制更改了实例冻结身份")
	}
	s.VirtualMachine.DataBytes *= 2
	if fingerprint(s) == original {
		t.Fatal("磁盘规格未纳入冻结身份")
	}
}
