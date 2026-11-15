//go:build linux && (amd64 || arm64)

package hostprobe

import (
	"os"
	"runtime"
	"testing"
)

func TestKVMIntegration(t *testing.T) {
	if os.Getenv("MONKEYAI_KVM_TEST") != "1" {
		t.Skip("需要显式启用并在具备 KVM 的隔离 Linux 验收机运行")
	}
	result := probeKVM(t.Context(), runtime.GOARCH, nativeKVM{})
	if result.Status != Supported || !valid(result) {
		t.Fatalf("真实 KVM 基础能力检查失败：%+v", result)
	}
	if result.Checks[len(result.Checks)-1].Name != "kvm_cleanup" {
		t.Fatalf("缺少真实资源回收确认：%+v", result)
	}
	t.Log("实际打开KVM、创建并关闭VM/vCPU通过；未运行虚拟机，不代表Firecracker工作负载已验收")
}
