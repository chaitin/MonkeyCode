package hostprobe

import (
	"context"
	"errors"
	"reflect"
	"syscall"
	"testing"
)

type ioctlCall struct {
	fd      int
	request uintptr
	arg     uintptr
}

type fakeKVM struct {
	openErr   error
	device    bool
	deviceErr error
	api       uintptr
	mmap      uintptr
	missing   *uintptr
	ioctlErr  map[uintptr]error
	closeErr  map[int]error
	opened    int
	closed    []int
	calls     []ioctlCall
	after     func(uintptr)
}

func kvmReady() *fakeKVM {
	return &fakeKVM{device: true, api: 12, mmap: 4096}
}
func (k *fakeKVM) Open() (int, error) {
	k.opened++
	return 10, k.openErr
}
func (k *fakeKVM) Device(int) (bool, error) { return k.device, k.deviceErr }
func (k *fakeKVM) Close(fd int) error {
	k.closed = append(k.closed, fd)
	return k.closeErr[fd]
}
func (k *fakeKVM) Ioctl(fd int, request, arg uintptr) (uintptr, error) {
	k.calls = append(k.calls, ioctlCall{fd, request, arg})
	if k.after != nil {
		k.after(request)
	}
	if err := k.ioctlErr[request]; err != nil {
		return 0, err
	}
	switch request {
	case kvmGetAPIVersion:
		return k.api, nil
	case kvmGetMmapSize:
		return k.mmap, nil
	case kvmCheckExt:
		if k.missing != nil && *k.missing == arg {
			return 0, nil
		}
		return 1, nil
	case kvmCreateVM:
		if fd != 10 || arg != 0 {
			return 0, syscall.EINVAL
		}
		return 11, nil
	case kvmCreateVCPU:
		if fd != 11 || arg != 0 {
			return 0, syscall.EINVAL
		}
		return 12, nil
	default:
		return 0, syscall.EINVAL
	}
}

func TestKVMCreatesVMAndVCPUThenClosesInReverse(t *testing.T) {
	for _, arch := range []string{"amd64", "arm64"} {
		t.Run(arch, func(t *testing.T) {
			k := kvmReady()
			c := probeKVM(t.Context(), arch, k)
			if c.Status != Supported || !valid(c) {
				t.Fatal(c)
			}
			if !reflect.DeepEqual(k.closed, []int{12, 11, 10}) {
				t.Fatalf("资源未按依赖顺序回收：%v", k.closed)
			}
			last := k.calls[len(k.calls)-1]
			if last != (ioctlCall{11, kvmCreateVCPU, 0}) {
				t.Fatalf("没有实际创建vCPU：%+v", last)
			}
			for _, call := range k.calls {
				if call.request == 0xae80 {
					t.Fatal("平台探测不能执行KVM_RUN")
				}
			}
		})
	}
}

func TestKVMOpenErrors(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status Status
	}{
		{syscall.ENOENT, Unsupported},
		{syscall.EACCES, Unsupported},
		{syscall.EPERM, Unsupported},
		{syscall.ENODEV, Unsupported},
		{syscall.EIO, Failed},
		{syscall.ENOMEM, Failed},
		{syscall.EBUSY, Failed},
		{syscall.EMFILE, Failed},
		{syscall.ELOOP, Failed},
	} {
		t.Run(tc.err.Error(), func(t *testing.T) {
			k := kvmReady()
			k.openErr = tc.err
			c := probeKVM(t.Context(), "amd64", k)
			if c.Status != tc.status || len(k.closed) != 0 || len(k.calls) != 0 {
				t.Fatalf("错误分类或清理不正确：%+v, %v", c, k.closed)
			}
		})
	}
}

func TestKVMRejectsInvalidDeviceAndAPI(t *testing.T) {
	for _, tc := range []struct {
		name   string
		edit   func(*fakeKVM)
		status Status
	}{
		{"普通文件", func(k *fakeKVM) { k.device = false }, Failed},
		{"设备检查失败", func(k *fakeKVM) { k.deviceErr = syscall.EIO }, Failed},
		{"API不匹配", func(k *fakeKVM) { k.api = 11 }, Unsupported},
		{"无效映射大小", func(k *fakeKVM) { k.mmap = 0 }, Failed},
		{"缺少user_memory", func(k *fakeKVM) { id := uintptr(3); k.missing = &id }, Unsupported},
	} {
		t.Run(tc.name, func(t *testing.T) {
			k := kvmReady()
			tc.edit(k)
			c := probeKVM(t.Context(), "amd64", k)
			if c.Status != tc.status || !reflect.DeepEqual(k.closed, []int{10}) {
				t.Fatalf("%+v closed=%v", c, k.closed)
			}
		})
	}
}

func TestKVMCreateFailuresDoNotLeak(t *testing.T) {
	for _, tc := range []struct {
		name    string
		request uintptr
		err     error
		status  Status
		closed  []int
	}{
		{"VM明确不支持", kvmCreateVM, syscall.ENODEV, Unsupported, []int{10}},
		{"VM临时失败", kvmCreateVM, syscall.ENOMEM, Failed, []int{10}},
		{"VM未知错误", kvmCreateVM, syscall.EINVAL, Failed, []int{10}},
		{"vCPU明确不支持", kvmCreateVCPU, syscall.EOPNOTSUPP, Unsupported, []int{11, 10}},
		{"vCPU临时失败", kvmCreateVCPU, syscall.EIO, Failed, []int{11, 10}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			k := kvmReady()
			k.ioctlErr = map[uintptr]error{tc.request: tc.err}
			c := probeKVM(t.Context(), "amd64", k)
			if c.Status != tc.status || !reflect.DeepEqual(k.closed, tc.closed) {
				t.Fatalf("%+v closed=%v", c, k.closed)
			}
		})
	}
}

func TestKVMCleanupFailureOverridesUnsupported(t *testing.T) {
	k := kvmReady()
	k.ioctlErr = map[uintptr]error{kvmCreateVCPU: syscall.EOPNOTSUPP}
	k.closeErr = map[int]error{11: syscall.EIO, 10: syscall.EIO}
	c := probeKVM(t.Context(), "amd64", k)
	if c.Status != Failed || !reflect.DeepEqual(k.closed, []int{11, 10}) {
		t.Fatalf("清理失败不能允许回退：%+v closed=%v", c, k.closed)
	}
}

func TestKVMCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	k := kvmReady()
	k.after = func(request uintptr) {
		if request == kvmCreateVM {
			cancel()
		}
	}
	defer cancel()
	c := probeKVM(ctx, "amd64", k)
	if c.Status != Failed || !reflect.DeepEqual(k.closed, []int{11, 10}) {
		t.Fatalf("取消后没有回收临时VM：%+v closed=%v", c, k.closed)
	}
}

func TestKVMUnsupportedArchitectureDoesNotOpenDevice(t *testing.T) {
	k := kvmReady()
	c := probeKVM(t.Context(), "386", k)
	if c.Status != Unsupported || k.opened != 0 {
		t.Fatal(c)
	}
}

func TestSetupErrorNeverAllowsFallback(t *testing.T) {
	err := errors.Join(errProbeSetup, syscall.EACCES)
	if probeStatus(err) != Failed {
		t.Fatal("描述符设置或清理异常不能归为平台不支持")
	}
}
