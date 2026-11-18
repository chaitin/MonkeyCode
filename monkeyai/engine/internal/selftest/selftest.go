package selftest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/hostprobe"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmnet"
)

type Config struct {
	Driver       string
	Architecture string
	Bundle       string
	DataDir      string
	Engine       string
	Version      string
}
type Check struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail"`
}
type Report struct {
	Version      int     `json:"version"`
	Scope        string  `json:"scope"`
	Driver       string  `json:"driver"`
	Architecture string  `json:"architecture"`
	Ready        bool    `json:"readiness_verified"`
	Workload     bool    `json:"workload_verified"`
	Checks       []Check `json:"checks"`
}
type bundle struct {
	Version int               `json:"version"`
	Files   map[string]string `json:"files"`
}

func Inspect(ctx context.Context, c Config) (report Report, err error) {
	report = Report{Version: 1, Scope: "driver_selftest", Driver: c.Driver, Architecture: runtime.GOARCH, Checks: []Check{}}
	defer func() {
		if err != nil {
			report.Ready = false
			report.Checks = append(report.Checks, Check{Name: "selftest", Detail: err.Error()})
		}
	}()
	if runtime.GOOS != "linux" || os.Geteuid() != 0 || c.Architecture != runtime.GOARCH {
		return report, errors.New("真实驱动自检需要对应架构Linux root")
	}
	if c.Driver != "firecracker" && c.Driver != "gvisor" {
		return report, errors.New("驱动自检不接受auto或普通容器")
	}
	if !filepath.IsAbs(c.DataDir) || filepath.Clean(c.DataDir) != c.DataDir || c.DataDir == "/" {
		return report, errors.New("自检数据目录无效")
	}
	probe, err := hostprobe.Inspect(ctx, hostprobe.Config{Architecture: c.Architecture, Driver: hostprobe.Driver(c.Driver)})
	if err != nil {
		return report, err
	}
	if probe.CandidateDriver != hostprobe.Driver(c.Driver) {
		return report, errors.New("驱动平台条件不满足")
	}
	report.Checks = append(report.Checks, Check{Name: "platform", Passed: true, Detail: "平台基础探测通过"})
	work, err := os.MkdirTemp(c.DataDir, ".driver-selftest-")
	if err != nil {
		return report, err
	}
	clean := false
	defer func() {
		if clean {
			err = errors.Join(err, os.RemoveAll(work))
		}
	}()
	if c.Driver == "gvisor" {
		err = testGVisor(ctx, c, work)
		clean = err == nil
	} else {
		clean, err = testFirecracker(ctx, c, work)
	}
	if err != nil {
		return report, err
	}
	report.Checks = append(report.Checks, Check{Name: "execution_and_cleanup", Passed: true, Detail: "受限驱动启动及资源回收通过；未执行用户工作负载"})
	report.Ready = true
	return report, nil
}
func readBundle(dir string) (bundle, error) {
	path := filepath.Join(dir, "manifest.json")
	info, err := os.Lstat(path)
	if err != nil {
		return bundle{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<10 {
		return bundle{}, errors.New("自检组件清单无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return bundle{}, err
	}
	var b bundle
	if json.Unmarshal(raw, &b) != nil || b.Version != 1 {
		return b, errors.New("自检组件清单版本无效")
	}
	for _, name := range []string{"firecracker", "jailer", "kernel", "mke2fs", "monkeyai-selftest"} {
		sum := b.Files[name]
		if len(sum) != 64 || strings.Trim(sum, "0123456789abcdef") != "" {
			return b, errors.New("自检组件摘要缺失")
		}
	}
	return b, nil
}
func tool(c Config, b bundle, name string) vmimage.Tool {
	return vmimage.Tool{Path: filepath.Join(c.Bundle, name), Digest: "sha256:" + b.Files[name]}
}
func testFirecracker(ctx context.Context, c Config, work string) (clean bool, result error) {
	if !filepath.IsAbs(c.Bundle) || filepath.Clean(c.Bundle) != c.Bundle {
		return false, errors.New("自检组件目录无效")
	}
	b, err := readBundle(c.Bundle)
	if err != nil {
		return true, err
	}
	for _, name := range []string{"firecracker", "jailer", "mke2fs", "monkeyai-selftest"} {
		if err := tool(c, b, name).Verify(ctx); err != nil {
			return true, err
		}
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return true, err
	}
	name := "selftest-" + hex.EncodeToString(random[:])
	id := storage.Key(name)
	socketRoot, err := os.MkdirTemp("/run", "mafc-")
	if err != nil {
		return true, err
	}
	defer func() {
		if clean {
			result = errors.Join(result, os.RemoveAll(socketRoot))
		}
	}()
	rate := firecracker.Rate{Bandwidth: firecracker.Bucket{Size: 4 << 20, RefillMS: 1000}, Operations: firecracker.Bucket{Size: 1000, RefillMS: 1000}}
	network, err := vmnet.New(vmnet.Config{Root: filepath.Join(work, "network"), GuestPool: netip.MustParsePrefix("172.30.0.0/16"), LinkPool: netip.MustParsePrefix("172.29.0.0/16"), DNS: []netip.Addr{netip.MustParseAddr("1.1.1.1")}, Rate: rate})
	if err != nil {
		return true, err
	}
	host, err := firecracker.NewSystemHost(firecracker.HostConfig{Root: filepath.Join(work, "host"), SocketRoot: socketRoot, Firecracker: tool(c, b, "firecracker"), Jailer: tool(c, b, "jailer"), Kernel: firecracker.Artifact{Path: filepath.Join(c.Bundle, "kernel"), Digest: "sha256:" + b.Files["kernel"]}, OverheadMiB: 128, DiskRate: rate, Network: network})
	if err != nil {
		return true, err
	}
	formatter, err := vmdisk.NewExt4(filepath.Join(c.Bundle, "mke2fs"))
	if err != nil {
		return true, err
	}
	rootfs := filepath.Join(work, "rootfs")
	if err := os.Mkdir(rootfs, 0700); err != nil {
		return true, err
	}
	data, err := os.ReadFile(filepath.Join(c.Bundle, "monkeyai-selftest"))
	if err != nil {
		return true, err
	}
	if err := os.WriteFile(filepath.Join(rootfs, "monkeyai-selftest"), data, 0755); err != nil {
		return true, err
	}
	disk := filepath.Join(work, "disk.ext4")
	if err := formatter.Populate(ctx, disk, 64<<20, rootfs); err != nil {
		return true, err
	}
	binding := guest.Binding{EnvironmentID: name, InstanceID: name, BootID: name}
	launch := firecracker.Launch{ID: id, BootID: name, VCPUs: 1, MemoryMiB: 256, Binding: binding, SelfTest: true, Disk: vmdisk.Disk{Spec: vmdisk.Spec{EnvironmentID: name, InstanceID: name, DiskBytes: 64 << 20}, Path: disk, Lease: name}}
	// Start可能在创建网络或启动进程后失败，因此无论返回值如何都尝试可信清理。
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		stopErr := host.Stop(cleanup, id)
		removeErr := error(nil)
		if stopErr == nil {
			removeErr = host.Remove(cleanup, id)
		}
		clean = stopErr == nil && removeErr == nil
		present, checkErr := network.HasAllocation(id)
		if checkErr != nil || present {
			clean = false
			removeErr = errors.Join(removeErr, checkErr, errors.New("隔离网络仍有待处理资源，保留自检目录"))
		}
		result = errors.Join(result, stopErr, removeErr)
	}()
	if err := host.Start(ctx, launch); err != nil {
		return false, err
	}
	client, err := host.GuestClient(id)
	if err != nil {
		return false, err
	}
	defer client.Close()
	ready, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	for {
		if _, err := client.Status(ready, lifecycle.Spec{}); err == nil {
			return false, nil
		}
		select {
		case <-ready.Done():
			return false, errors.New("最小虚拟机vsock握手超时")
		case <-time.After(100 * time.Millisecond):
		}
	}
}
func testGVisor(ctx context.Context, c Config, work string) (result error) {
	if !filepath.IsAbs(c.Engine) || c.Version == "" {
		return errors.New("缺少固定engine程序及版本")
	}
	root := filepath.Join(work, "rootfs")
	if err := os.Mkdir(root, 0755); err != nil {
		return err
	}
	in, err := os.Open(c.Engine)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(filepath.Join(root, "probe"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	if err := errors.Join(copyErr, out.Close()); err != nil {
		return err
	}
	var token [12]byte
	if _, err := rand.Read(token[:]); err != nil {
		return err
	}
	id := "monkeyai-selftest-" + hex.EncodeToString(token[:])
	config := map[string]any{"ociVersion": "1.0.2", "root": map[string]any{"path": "rootfs", "readonly": true}, "process": map[string]any{"terminal": false, "args": []string{"/probe", "version"}, "cwd": "/", "env": []string{"PATH=/", "HOME=/"}, "user": map[string]int{"uid": 1000, "gid": 1000}, "noNewPrivileges": true}, "linux": map[string]any{"namespaces": []map[string]string{{"type": "pid"}, {"type": "mount"}, {"type": "network"}, {"type": "ipc"}, {"type": "uts"}}, "resources": map[string]any{"memory": map[string]int64{"limit": 256 << 20}, "pids": map[string]int{"limit": 64}}}}
	raw, _ := json.Marshal(config)
	if err := os.WriteFile(filepath.Join(work, "config.json"), raw, 0600); err != nil {
		return err
	}
	runtimeRoot := filepath.Join(work, "runsc")
	runsc := filepath.Join(filepath.Dir(c.Engine), "runsc")
	args := []string{"--root", runtimeRoot, "--platform=systrap", "--network=none", "run", "--bundle", work, id}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(cleanup, runsc, "--root", runtimeRoot, "delete", "--force", id)
		deleteErr := cmd.Run()
		if deleteErr != nil && result == nil {
			// run 成功退出默认已删除状态；仅此已知成功路径允许确认状态目录不存在。
			if _, err := os.Lstat(filepath.Join(runtimeRoot, id)); errors.Is(err, os.ErrNotExist) {
				deleteErr = nil
			}
		}
		result = errors.Join(result, deleteErr)
	}()
	cmd := exec.CommandContext(ctx, runsc, args...)
	var output limitedOutput
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("gVisor受限执行失败: %w", err)
	}
	if output.exceeded || strings.TrimSpace(string(output.data)) != c.Version {
		return errors.New("gVisor执行结果或engine版本不符")
	}
	return nil
}

type limitedOutput struct {
	data     []byte
	exceeded bool
}

func (b *limitedOutput) Write(p []byte) (int, error) {
	n := len(p)
	left := 8192 - len(b.data)
	if len(p) > left {
		b.exceeded = true
		p = p[:left]
	}
	b.data = append(b.data, p...)
	return n, nil
}
