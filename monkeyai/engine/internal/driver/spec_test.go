package driver

import (
	"archive/tar"
	"bytes"
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/network"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/opencontainers/go-digest"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

func sample() lifecycle.Spec {
	digest := "sha256:" + strings.Repeat("a", 64)
	return lifecycle.Spec{EnvironmentID: "env-a", InstanceID: "instance-a", Generation: 1, DesiredState: lifecycle.DesiredRunning, Driver: "gvisor", Image: "registry.example/image@" + digest, ImageDigest: digest, NetworkPolicy: "isolated", Resource: lifecycle.Resource{CPUMillis: 1500, MemoryBytes: 1 << 30, HostTasks: 512, TemporaryBytes: 128 << 20}, Volumes: []lifecycle.Volume{{ID: "project", Purpose: "workspace", Bytes: 1 << 30, Inodes: 10000}, {ID: "home", Purpose: "home", Bytes: 1 << 30, Inodes: 10000}, {ID: "runtime", Purpose: "runtime", Bytes: 1 << 30, Inodes: 10000}}}
}
func TestSpecEnforcesIsolationAndBudget(t *testing.T) {
	s := sample()
	cfg := ocispec.Image{Config: ocispec.ImageConfig{Entrypoint: []string{"/bin/task"}, Cmd: []string{"serve"}, Env: []string{"HOME=/root", "USER=root", "PATH=/usr/bin:/bin"}, Volumes: map[string]struct{}{"/etc": {}}}}
	mounts := []storage.Mount{{Source: "/data/project", Target: "/workspace"}, {Source: "/data/home", Target: "/home/monkey"}, {Source: "/data/runtime", Target: "/var/lib/monkeyai"}}
	if err := validateMounts(s, mounts); err != nil {
		t.Fatal(err)
	}
	o := buildSpec(s, cfg, mounts)
	if !o.Root.Readonly || o.Process.User.UID != 1000 || !o.Process.NoNewPrivileges || len(o.Process.Capabilities.Effective) != 0 {
		t.Fatal("执行身份或权限边界错误")
	}
	if *o.Linux.Resources.CPU.Quota != 150000 || *o.Linux.Resources.Memory.Limit != 1<<30 || *o.Linux.Resources.Pids.Limit != 512 || o.Linux.Resources.Unified["memory.swap.max"] != "0" {
		t.Fatal("资源上限错误")
	}
	for _, e := range o.Process.Env {
		if e == "HOME=/root" || e == "USER=root" {
			t.Fatal("镜像覆盖受控身份")
		}
	}
	for _, ns := range o.Linux.Namespaces {
		if ns.Path != "" {
			t.Fatal("使用了宿主 namespace")
		}
	}
	network := false
	for _, ns := range o.Linux.Namespaces {
		network = network || ns.Type == specs.NetworkNamespace
	}
	if !network {
		t.Fatal("缺少独立网络 namespace")
	}
	for _, m := range o.Mounts {
		if m.Destination == "/etc" || m.Source == "/var/run/docker.sock" {
			t.Fatal("接受镜像的任意挂载")
		}
	}
	mounts[0].Target = "/etc"
	if err := validateMounts(s, mounts); err == nil {
		t.Fatal("接受未知卷目标")
	}
}
func TestInstanceNamesCannotEscapeAndAreEnvironmentBound(t *testing.T) {
	a, b := sample(), sample()
	a.EnvironmentID = "a:.."
	b.EnvironmentID = "b"
	if strings.ContainsAny(instanceKey(a), "/:") || instanceKey(a) == instanceKey(b) {
		t.Fatal("实例路径未隔离")
	}
}
func TestPullLimitBoundsTotalAndDeduplicates(t *testing.T) {
	limit := pullLimit()
	d := ocispec.Descriptor{Digest: digest.FromString("one"), Size: 1 << 30}
	for range 8 {
		if _, err := limit(context.Background(), d); err != nil {
			t.Fatal("重复摘要不应重复计数")
		}
	}
	for _, name := range []string{"two", "three", "four"} {
		d.Digest = digest.FromString(name)
		if _, err := limit(context.Background(), d); err != nil {
			t.Fatal(err)
		}
	}
	d.Digest = digest.FromString("five")
	if _, err := limit(context.Background(), d); err == nil {
		t.Fatal("未拒绝超出压缩预算")
	}
}
func TestScanRejectsExpansionAndTooManyFiles(t *testing.T) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	if err := tw.WriteHeader(&tar.Header{Name: "file", Mode: 0600, Size: 4096}); err != nil {
		t.Fatal(err)
	}
	tw.Write(make([]byte, 4096))
	tw.Close()
	for _, tt := range []struct {
		budget int64
		files  int
	}{{1024, 0}, {1 << 20, 1000000}} {
		remaining, files := tt.budget, tt.files
		if err := scanLayer(context.Background(), bytes.NewReader(buf.Bytes()), &remaining, &files); err == nil {
			t.Fatal("接受超出解包预算的镜像")
		}
	}
	remaining, files := int64(1<<20), 0
	if err := scanLayer(context.Background(), bytes.NewReader(buf.Bytes()), &remaining, &files); err != nil {
		t.Fatal(err)
	}
	if files != 1 || remaining >= 1<<20 {
		t.Fatal("解包预算未记账")
	}
}

func TestPublicNetworkBindsOnlyNamespaceAndReadOnlyDNS(t *testing.T) {
	s := sample()
	s.NetworkPolicy = "public-only"
	if err := s.Validate(); err != nil {
		t.Fatal(err)
	}
	a := network.Attachment{Namespace: "/run/netns/mae-test", Resolver: "/var/lib/monkeyai-engine/control/network/test.resolv.conf"}
	o := withNetwork(buildSpec(s, ocispec.Image{}, nil), a)
	count := 0
	for _, ns := range o.Linux.Namespaces {
		if ns.Type == specs.NetworkNamespace {
			if ns.Path != a.Namespace {
				t.Fatal("网络命名空间错误")
			}
			count++
		} else if ns.Path != "" {
			t.Fatal("共享了其他宿主命名空间")
		}
	}
	if count != 1 {
		t.Fatal("网络 namespace 数量错误")
	}
	for _, m := range o.Mounts {
		if m.Destination == "/etc/resolv.conf" {
			if m.Source != a.Resolver || !slices.Contains(m.Options, "ro") || !slices.Contains(m.Options, "noexec") {
				t.Fatal(m)
			}
			return
		}
	}
	t.Fatal("缺少固定 DNS 挂载")
}

func TestSandboxTasksAreIndependentFromHostThreads(t *testing.T) {
	s := sample()
	s.Resource.HostTasks = 64
	o := buildSpec(s, ocispec.Image{}, nil)
	for _, r := range o.Process.Rlimits {
		if r.Type == "RLIMIT_NPROC" {
			if r.Soft != 512 || r.Hard != 512 || o.Process.User.UID != 1000 || len(o.Process.Capabilities.Permitted) != 0 {
				t.Fatal(r)
			}
			return
		}
	}
	t.Fatal("缺少沙箱任务上限")
}

func TestTaskLimitRejectsLegacyAndPrivilegedSpecs(t *testing.T) {
	for _, change := range []func(*specs.Spec){
		func(s *specs.Spec) { s.Process.Rlimits = nil },
		func(s *specs.Spec) { s.Process.User.UID = 0 },
		func(s *specs.Spec) { s.Process.NoNewPrivileges = false },
		func(s *specs.Spec) { s.Process.Capabilities.Permitted = []string{"CAP_SYS_RESOURCE"} },
		func(s *specs.Spec) {
			s.Process.Rlimits = append(s.Process.Rlimits, specs.POSIXRlimit{Type: "RLIMIT_NPROC", Soft: 512, Hard: 512})
		},
	} {
		o := buildSpec(sample(), ocispec.Image{}, nil)
		if taskLimit(o) != nil {
			t.Fatal("拒绝受控规格")
		}
		change(o)
		if taskLimit(o) == nil {
			t.Fatal("接受缺少限制或具备特权的规格")
		}
	}
}

func TestManagedRuntimeIgnoresImageEntrypointAndEnvironment(t *testing.T) {
	s := sample()
	s.NetworkPolicy = "public-only"
	s.Runtime = &lifecycle.Runtime{Server: "https://ai.example.com", ServerID: "server", UserID: "user"}
	o := buildSpec(s, ocispec.Image{Config: ocispec.ImageConfig{Entrypoint: []string{"/bin/untrusted"}, Env: []string{"LD_PRELOAD=/home/monkey/hook.so", "MONKEYAI_PROFILE_DIR=/tmp/other"}}}, nil)
	if !slices.Equal(o.Process.Args, []string{"/usr/bin/tini", "-g", "--", "/bin/sleep", "infinity"}) {
		t.Fatal("使用了镜像自定义入口")
	}
	if slices.ContainsFunc(o.Process.Env, func(v string) bool { return strings.HasPrefix(v, "LD_PRELOAD=") || strings.HasPrefix(v, "MONKEYAI_") }) {
		t.Fatal("运行时继承了镜像身份或执行配置")
	}
}
