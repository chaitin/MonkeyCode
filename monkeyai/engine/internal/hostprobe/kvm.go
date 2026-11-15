package hostprobe

import (
	"context"
	"errors"
	"fmt"
	"syscall"
)

// Linux KVM UAPI 的稳定 ioctl 编号；仅在 amd64/arm64 Linux 上调用。
const (
	kvmGetAPIVersion = 0xae00
	kvmCreateVM      = 0xae01
	kvmCheckExt      = 0xae03
	kvmGetMmapSize   = 0xae04
	kvmCreateVCPU    = 0xae41
)

var errProbeSetup = errors.New("探测资源设置或清理失败")

type capability struct {
	name string
	id   uintptr
}

type kvmSystem interface {
	Open() (int, error)
	Device(int) (bool, error)
	Ioctl(int, uintptr, uintptr) (uintptr, error)
	Close(int) error
}

func probeKVM(ctx context.Context, arch string, k kvmSystem) (c Candidate) {
	c.Driver = Firecracker
	if arch != "amd64" && arch != "arm64" {
		c.add("kvm_architecture", Unsupported, "KVM 探测只支持 amd64 和 arm64")
		return c
	}
	if err := ctx.Err(); err != nil {
		c.add("kvm_context", Failed, err.Error())
		return c
	}
	fd, err := k.Open()
	if err != nil {
		c.add("kvm_access", probeStatus(err), fmt.Sprintf("无法访问 /dev/kvm：%v", err))
		return c
	}
	fds := []int{fd}
	defer func() {
		var closeErr error
		for i := len(fds) - 1; i >= 0; i-- {
			closeErr = errors.Join(closeErr, k.Close(fds[i]))
		}
		if closeErr != nil {
			c.add("kvm_cleanup", Failed, fmt.Sprintf("临时 KVM 资源关闭失败：%v", closeErr))
		} else {
			c.add("kvm_cleanup", Supported, "临时 KVM 句柄已释放；未运行虚拟机")
		}
	}()
	device, err := k.Device(fd)
	if err != nil || !device {
		c.add("kvm_device", Failed, fmt.Sprintf("/dev/kvm 不是可确认的字符设备：%v", err))
		return c
	}
	c.add("kvm_access", Supported, "/dev/kvm 可读写")
	call := func(name string, fd int, request, arg uintptr) (uintptr, bool) {
		if err := ctx.Err(); err != nil {
			c.add(name, Failed, err.Error())
			return 0, false
		}
		value, err := k.Ioctl(fd, request, arg)
		if err != nil {
			c.add(name, probeStatus(err), fmt.Sprintf("KVM 操作失败：%v", err))
			return 0, false
		}
		return value, true
	}
	api, ok := call("kvm_api", fd, kvmGetAPIVersion, 0)
	if !ok {
		return c
	}
	if api != 12 {
		c.add("kvm_api", Unsupported, fmt.Sprintf("KVM API 版本为 %d，需要 12", api))
		return c
	}
	c.add("kvm_api", Supported, "KVM API 12")

	// 这里只检查基础能力；固定 Firecracker 发行仍需自己的完整预检和启动自检。
	caps := []capability{
		{"user_memory", 3}, {"irqfd", 32}, {"ioeventfd", 36}, {"immediate_exit", 136},
	}
	if arch == "amd64" {
		caps = append(caps, capability{"irqchip", 0}, capability{"set_tss_addr", 4}, capability{"mp_state", 14})
	} else {
		caps = append(caps, capability{"one_reg", 70}, capability{"arm_psci_0_2", 102})
	}
	for _, cap := range caps {
		name := "kvm_" + cap.name
		value, ok := call(name, fd, kvmCheckExt, cap.id)
		if !ok {
			return c
		}
		if value == 0 {
			c.add(name, Unsupported, "缺少 KVM 能力 "+cap.name)
			return c
		}
		c.add(name, Supported, "KVM 能力 "+cap.name+" 可用")
	}
	mmap, ok := call("kvm_vcpu_mmap", fd, kvmGetMmapSize, 0)
	if !ok {
		return c
	}
	if mmap == 0 {
		c.add("kvm_vcpu_mmap", Failed, "KVM 返回无效的 vCPU 映射大小")
		return c
	}
	c.add("kvm_vcpu_mmap", Supported, fmt.Sprintf("vCPU 映射大小 %d 字节", mmap))
	vm, ok := call("kvm_create_vm", fd, kvmCreateVM, 0)
	if !ok {
		return c
	}
	fds = append(fds, int(vm))
	c.add("kvm_create_vm", Supported, "成功创建临时 KVM VM")
	vcpu, ok := call("kvm_create_vcpu", int(vm), kvmCreateVCPU, 0)
	if !ok {
		return c
	}
	fds = append(fds, int(vcpu))
	c.add("kvm_create_vcpu", Supported, "成功创建临时 vCPU；仍需 Firecracker 实际启动验证")
	return c
}

func probeStatus(err error) Status {
	if errors.Is(err, errProbeSetup) {
		return Failed
	}
	for _, reason := range []error{
		syscall.ENOENT, syscall.ENODEV, syscall.ENXIO, syscall.EACCES,
		syscall.EPERM, syscall.ENOSYS, syscall.EOPNOTSUPP, syscall.ENOTTY,
	} {
		if errors.Is(err, reason) {
			return Unsupported
		}
	}
	return Failed
}
