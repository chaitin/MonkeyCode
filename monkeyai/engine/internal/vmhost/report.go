package vmhost

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/hostprobe"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/preflight"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
)

func (d *Driver) Report(ctx context.Context, cfg control.Config) (preflight.Report, error) {
	report := preflight.Report{Version: 1, At: time.Now().UTC(), OS: runtime.GOOS, Architecture: runtime.GOARCH, Driver: "firecracker", RuntimeProtocol: 1, RuntimeUpdateProtocol: 2, EnvironmentProtocol: 4, ProtectionProtocol: 1, NetworkPolicies: []string{"isolated", "public-only"}, System: preflight.ReadSystem(d.data), Prerequisites: true, Checks: []preflight.Check{}}
	check := func(name string, passed bool, detail string) {
		report.Checks = append(report.Checks, preflight.Check{Name: name, Passed: passed, Detail: detail})
		if !passed {
			report.Prerequisites = false
		}
	}
	platform, err := hostprobe.Inspect(ctx, hostprobe.Config{Architecture: cfg.Architecture, Driver: hostprobe.Firecracker})
	check("firecracker_platform", err == nil && platform.CandidateDriver == hostprobe.Firecracker, "Linux、KVM、TUN及宿主基础条件")
	vm := lifecycle.VirtualMachine{Architecture: cfg.Architecture, BundleSHA256: d.config.DefaultBundle, SystemBytes: d.config.SystemBytes, DataBytes: d.config.DataBytes}
	check("virtual_machine_defaults", vm.Validate() == nil, "固定组件及默认双盘规格")
	receipt := cfg.SelfTest
	check("driver_selftest", receipt != nil && receipt.Driver == "firecracker" && receipt.Architecture == cfg.Architecture && receipt.BundleSHA256 == d.config.DefaultBundle && !receipt.At.IsZero(), "对应内核和VMM组件的真实启动与vsock自检记录")
	if vm.Validate() == nil {
		spec := lifecycle.Spec{EnvironmentID: "preflight", InstanceID: "preflight", Generation: 1, DesiredState: lifecycle.DesiredRunning, Driver: "firecracker", VirtualMachine: &vm, Image: "server.example/environments/preflight@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ImageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", NetworkPolicy: "public-only", Resource: lifecycle.Resource{CPUMillis: 1000, MemoryBytes: 256 << 20, HostTasks: 512, TemporaryBytes: 16 << 20}, Volumes: []lifecycle.Volume{{ID: "workspace", Purpose: "workspace"}, {ID: "home", Purpose: "home"}, {ID: "runtime", Purpose: "runtime"}}}
		dir, release, componentErr := d.components(spec)
		check("fixed_components", componentErr == nil, "组件清单及环境依赖身份")
		if componentErr == nil {
			for _, name := range []string{"firecracker", "jailer", "umoci", "mke2fs", "monkeyai-guest"} {
				err := (vmimage.Tool{Path: filepath.Join(dir, name), Digest: "sha256:" + release.Files[name]}).Verify(ctx)
				check(name, err == nil, "固定摘要可执行组件")
			}
			err := (firecracker.Artifact{Path: filepath.Join(dir, "kernel"), Digest: "sha256:" + release.Files["kernel"]}).Verify(ctx)
			check("kernel", err == nil, "固定摘要内核")
		}
		report.VirtualMachine, _ = json.Marshal(vm)
	}
	for _, tool := range []string{"systemd-run", "systemctl", "ip", "nft", "sysctl"} {
		_, err := exec.LookPath(tool)
		check(tool, err == nil, "宿主运行工具")
	}
	pool, err := d.pool()
	if err != nil {
		check("storage_pressure", false, "无法核对物理容量保护状态")
	} else {
		pressure, err := pool.Refresh(ctx)
		report.DiskPressure = string(pressure)
		check("storage_pressure", err == nil && pressure == vmdisk.PressureNormal, "容量及inode必须高于恢复水位后才接受新分配")
	}
	return report, nil
}
