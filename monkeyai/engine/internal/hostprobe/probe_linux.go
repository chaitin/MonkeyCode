//go:build linux && (amd64 || arm64)

package hostprobe

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

func (local) Probe(ctx context.Context, driver Driver, arch string) Candidate {
	if driver == Firecracker {
		result := probeKVM(ctx, arch, nativeKVM{})
		if result.Status == Supported {
			if err := ctx.Err(); err != nil {
				result.add("tun", Failed, err.Error())
			} else if err := checkTun(); err != nil {
				result.add("tun", probeStatus(err), fmt.Sprintf("TUN/TAP 设备检查失败：%v", err))
			} else {
				result.add("tun", Supported, "TUN/TAP 设备可访问；创建权限和网络隔离仍需自检")
			}
		}
		return result
	}
	return probeGVisor(ctx)
}

type nativeKVM struct{}

func (nativeKVM) Open() (int, error) {
	return unix.Open("/dev/kvm", unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
}

func (nativeKVM) Device(fd int) (bool, error) {
	var stat unix.Stat_t
	err := unix.Fstat(fd, &stat)
	return stat.Mode&unix.S_IFMT == unix.S_IFCHR, err
}

func (nativeKVM) Ioctl(fd int, request, arg uintptr) (uintptr, error) {
	createsFD := request == kvmCreateVM || request == kvmCreateVCPU
	if createsFD {
		syscall.ForkLock.RLock()
		defer syscall.ForkLock.RUnlock()
	}
	value, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), request, arg)
	if errno != 0 {
		return 0, errno
	}
	if createsFD {
		if _, err := unix.FcntlInt(value, unix.F_SETFD, unix.FD_CLOEXEC); err != nil {
			return 0, errors.Join(errProbeSetup, err, unix.Close(int(value)))
		}
	}
	return value, nil
}

func (nativeKVM) Close(fd int) error { return unix.Close(fd) }

func checkTun() (err error) {
	fd, err := unix.Open("/dev/net/tun", unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := unix.Close(fd); closeErr != nil {
			err = errors.Join(errProbeSetup, err, closeErr)
		}
	}()
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		return errors.Join(errProbeSetup, err)
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFCHR {
		return errors.New("/dev/net/tun 不是字符设备")
	}
	features, err := unix.IoctlGetInt(fd, unix.TUNGETFEATURES)
	if err != nil {
		return err
	}
	if features&unix.IFF_TAP == 0 {
		return fmt.Errorf("TUN 设备不支持 TAP：%w", unix.EOPNOTSUPP)
	}
	return nil
}

func probeGVisor(ctx context.Context) (c Candidate) {
	c.Driver = GVisor
	if err := ctx.Err(); err != nil {
		c.add("gvisor_context", Failed, err.Error())
		return c
	}
	if runtime.GOARCH == "arm64" && os.Getpagesize() != 4096 {
		c.add("gvisor_page_size", Unsupported, fmt.Sprintf("当前 ARM64 runsc 发行要求 4KiB 页，实际为 %d 字节", os.Getpagesize()))
		return c
	}
	action := uint32(unix.SECCOMP_RET_TRAP)
	_, _, errno := unix.Syscall6(unix.SYS_SECCOMP, unix.SECCOMP_GET_ACTION_AVAIL, 0, uintptr(unsafe.Pointer(&action)), 0, 0, 0)
	runtime.KeepAlive(action)
	if errno != 0 {
		c.add("seccomp_trap", probeStatus(errno), fmt.Sprintf("systrap 所需 SECCOMP_RET_TRAP 不可确认：%v", errno))
		return c
	}
	c.add("seccomp_trap", Supported, "内核支持 SECCOMP_RET_TRAP；未修改当前进程过滤器")
	if err := ctx.Err(); err != nil {
		c.add("gvisor_context", Failed, err.Error())
		return c
	}
	fd, err := unix.PidfdOpen(os.Getpid(), 0)
	if err != nil {
		c.add("pidfd", probeStatus(err), fmt.Sprintf("当前 runsc 需要 pidfd_open：%v", err))
		return c
	}
	if err := unix.Close(fd); err != nil {
		c.add("pidfd_cleanup", Failed, fmt.Sprintf("临时 pidfd 关闭失败：%v", err))
		return c
	}
	c.add("pidfd", Supported, "pidfd_open 可用且临时句柄已释放；仍需 Docker/runsc 实际自检")
	return c
}
