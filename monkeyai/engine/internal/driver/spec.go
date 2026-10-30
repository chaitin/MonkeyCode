package driver

import (
	"errors"
	"fmt"
	"path/filepath"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/network"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

const sandboxTasks = uint64(512)

func buildSpec(s lifecycle.Spec, image ocispec.Image, mounts []storage.Mount) *specs.Spec {
	r := s.Resource
	quota, period, zero := r.CPUMillis*100, uint64(100000), int64(0)
	args := append(slices.Clone(image.Config.Entrypoint), image.Config.Cmd...)
	env := []string{}
	for _, e := range image.Config.Env {
		if len(e) > 0 && !hasKey(e, "HOME") && !hasKey(e, "USER") && !hasKey(e, "LOGNAME") {
			env = append(env, e)
		}
	}
	if s.Runtime != nil {
		args = []string{"/usr/bin/tini", "-g", "--", "/bin/sleep", "infinity"}
		env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8"}
	}
	env = append(env, "HOME=/home/monkey", "USER=monkey", "LOGNAME=monkey")
	o := &specs.Spec{Version: specs.Version, Root: &specs.Root{Path: "rootfs", Readonly: true}, Hostname: "monkeyai",
		Process: &specs.Process{User: specs.User{UID: 1000, GID: 1000}, Args: args, Env: env, Cwd: "/workspace", NoNewPrivileges: true, Capabilities: &specs.LinuxCapabilities{}, Rlimits: []specs.POSIXRlimit{{Type: "RLIMIT_NOFILE", Soft: 4096, Hard: 4096}, {Type: "RLIMIT_NPROC", Soft: sandboxTasks, Hard: sandboxTasks}}},
		Linux: &specs.Linux{CgroupsPath: "/monkeyai/" + instanceKey(s) + "/sandbox", Namespaces: []specs.LinuxNamespace{{Type: specs.PIDNamespace}, {Type: specs.IPCNamespace}, {Type: specs.UTSNamespace}, {Type: specs.MountNamespace}, {Type: specs.NetworkNamespace}, {Type: specs.CgroupNamespace}},
			Resources:   &specs.LinuxResources{CPU: &specs.LinuxCPU{Quota: &quota, Period: &period}, Memory: &specs.LinuxMemory{Limit: &r.MemoryBytes, Swap: &r.MemoryBytes}, Pids: &specs.LinuxPids{Limit: &r.HostTasks}, Unified: map[string]string{"memory.swap.max": fmt.Sprint(zero)}},
			MaskedPaths: []string{"/proc/acpi", "/proc/kcore", "/proc/keys", "/proc/latency_stats", "/proc/timer_list", "/proc/scsi", "/sys/firmware"}, ReadonlyPaths: []string{"/proc/asound", "/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"}},
		Mounts: []specs.Mount{{Destination: "/proc", Type: "proc", Source: "proc", Options: []string{"nosuid", "noexec", "nodev"}}, {Destination: "/sys", Type: "sysfs", Source: "sysfs", Options: []string{"ro", "nosuid", "noexec", "nodev"}},
			{Destination: "/dev", Type: "tmpfs", Source: "tmpfs", Options: []string{"nosuid", "strictatime", "mode=755", "size=1048576"}},
			{Destination: "/dev/pts", Type: "devpts", Source: "devpts", Options: []string{"nosuid", "noexec", "newinstance", "ptmxmode=0666", "mode=0620", "gid=5"}}}}
	// 三个临时挂载的容量之和等于规格预算，内存上限另由整个沙箱 cgroup 约束。
	for _, m := range []struct {
		target string
		size   int64
	}{{"/tmp", r.TemporaryBytes / 2}, {"/run", r.TemporaryBytes / 4}, {"/dev/shm", r.TemporaryBytes / 4}} {
		o.Mounts = append(o.Mounts, specs.Mount{Destination: m.target, Type: "tmpfs", Source: "tmpfs", Options: []string{"nosuid", "nodev", "mode=1777", fmt.Sprintf("size=%d", m.size)}})
	}
	for _, m := range mounts {
		o.Mounts = append(o.Mounts, specs.Mount{Destination: m.Target, Type: "bind", Source: m.Source, Options: []string{"bind", "rw", "nosuid", "nodev", "private"}})
	}
	return o
}
func hasKey(value, key string) bool { return len(value) > len(key) && value[:len(key)+1] == key+"=" }
func validateMounts(s lifecycle.Spec, mounts []storage.Mount) error {
	if len(mounts) != len(s.Volumes) {
		return errors.New("持久卷挂载数量不匹配")
	}
	seen := map[string]bool{}
	for _, m := range mounts {
		if !filepath.IsAbs(m.Source) || filepath.Clean(m.Source) != m.Source || m.Source == "/" || seen[m.Target] {
			return errors.New("卷驱动返回无效挂载")
		}
		if !slices.ContainsFunc(s.Volumes, func(v lifecycle.Volume) bool { return v.Target() == m.Target }) {
			return errors.New("卷驱动返回未知挂载目标")
		}
		seen[m.Target] = true
	}
	return nil
}
func instanceKey(s lifecycle.Spec) string {
	return "mc-" + storage.Key(s.EnvironmentID + "\n" + s.InstanceID)[:48]
}

func withNetwork(s *specs.Spec, a network.Attachment) *specs.Spec {
	if a.Namespace == "" {
		return s
	}
	for i := range s.Linux.Namespaces {
		if s.Linux.Namespaces[i].Type == specs.NetworkNamespace {
			s.Linux.Namespaces[i].Path = a.Namespace
		}
	}
	s.Mounts = append(s.Mounts, specs.Mount{Destination: "/etc/resolv.conf", Type: "bind", Source: a.Resolver, Options: []string{"bind", "ro", "nosuid", "nodev", "noexec", "private"}})
	return s
}
