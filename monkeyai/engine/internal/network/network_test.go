package network

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func config() Config {
	return Config{Subnet: "10.240.0.0/24", DNS: []string{"1.1.1.1"}, PublicTCPPorts: []uint16{22, 80, 443}}
}
func spec() lifecycle.Spec {
	d := "sha256:" + strings.Repeat("a", 64)
	return lifecycle.Spec{EnvironmentID: "env", InstanceID: "instance", Generation: 1, DesiredState: lifecycle.DesiredRunning, Driver: "gvisor", Image: "example.com/image@" + d, ImageDigest: d, NetworkPolicy: "public-only", Resource: lifecycle.Resource{CPUMillis: 1000, MemoryBytes: 1 << 30, HostTasks: 512, TemporaryBytes: 64 << 20}, Volumes: []lifecycle.Volume{{ID: "w", Purpose: "workspace", Bytes: 1 << 30, Inodes: 1024}, {ID: "h", Purpose: "home", Bytes: 1 << 30, Inodes: 1024}, {ID: "r", Purpose: "runtime", Bytes: 1 << 30, Inodes: 1024}}}
}
func TestConfigRejectsUnsafeAddressesAndCommands(t *testing.T) {
	for name, change := range map[string]func(*Config){
		"public-pool":         func(c *Config) { c.Subnet = "8.8.0.0/16" },
		"host-bits":           func(c *Config) { c.Subnet = "10.240.0.1/24" },
		"broad-pool":          func(c *Config) { c.Subnet = "10.0.0.0/8" },
		"private-dns":         func(c *Config) { c.DNS = []string{"192.168.1.1"} },
		"ipv6":                func(c *Config) { c.DNS = []string{"2606:4700:4700::1111"} },
		"metadata-dns":        func(c *Config) { c.DNS = []string{"168.63.129.16"} },
		"dns-injection":       func(c *Config) { c.DNS = []string{"1.1.1.1; accept"} },
		"dns-duplicate":       func(c *Config) { c.DNS = []string{"1.1.1.1", "1.1.1.1"} },
		"dns-port":            func(c *Config) { c.PublicTCPPorts = []uint16{53} },
		"dot-port":            func(c *Config) { c.PublicTCPPorts = []uint16{853} },
		"metadata-exception":  func(c *Config) { c.Services = []Service{{"100.100.100.200", []uint16{80}}} },
		"linklocal-exception": func(c *Config) { c.Services = []Service{{"169.254.169.254", []uint16{80}}} },
		"pool-exception":      func(c *Config) { c.Services = []Service{{"10.240.0.12", []uint16{80}}} },
		"bad-deny":            func(c *Config) { c.Deny = []string{"10.0.0.1/8"} },
	} {
		t.Run(name, func(t *testing.T) {
			c := config()
			change(&c)
			if c.Validate() == nil {
				t.Fatal("接受危险配置")
			}
		})
	}
	raw, _ := json.Marshal(config())
	for _, v := range []string{string(raw) + "{}", strings.Replace(string(raw), `"subnet":`, `"unknown":1,"subnet":`, 1), strings.Repeat(" ", 33<<10)} {
		if _, err := Decode(strings.NewReader(v)); err == nil {
			t.Fatal("接受未知或超限配置")
		}
	}
	c := config()
	c.Services = []Service{{"10.20.0.10", []uint16{443}}}
	if c.Validate() != nil {
		t.Fatal("应允许明确内部服务例外")
	}
}
func TestRulesKeepHardDenyAheadOfExceptions(t *testing.T) {
	b := binding{EnvironmentID: "env", InstanceID: "instance", Config: config(), Connection: Connection{"veth123", "10.240.0.2", "10.240.0.1"}}
	b.Config.Services = []Service{{"10.20.0.10", []uint16{443}}}
	b.Config.Deny = []string{"10.20.0.0/16"}
	r := rules(b, []string{"192.168.9.0/24"})
	ordered := []string{"ip saddr != 10.240.0.2 drop", "fib daddr type local drop", "100.100.100.200/32", "10.20.0.0/16", "ip daddr 1.1.1.1 udp dport 53 accept", "tcp dport { 53, 853 } drop", "ip daddr 10.20.0.10 tcp dport { 443 } accept", "192.168.9.0/24", "tcp dport { 22, 80, 443 } accept; drop;"}
	last := -1
	for _, want := range ordered {
		i := strings.Index(r, want)
		if i <= last {
			t.Fatalf("规则顺序错误: %s\n%s", want, r)
		}
		last = i
	}
	for _, want := range []string{`oifname "veth123" ip daddr 10.240.0.2 ct state established,related accept`, `oifname "veth123" drop`, `hook ingress device "veth123"`, `policy drop; ether type arp arp saddr ip 10.240.0.2 arp daddr ip 10.240.0.1 accept`, `ether type ip ip saddr 10.240.0.2 accept`} {
		if !strings.Contains(r, want) {
			t.Fatal(want)
		}
	}
	if strings.Contains(r, "flush ruleset") || strings.Contains(r, "udp dport { 22") {
		t.Fatal("扩大放行范围")
	}
	for _, addr := range []string{"10.240.0.0", "10.240.0.1", "10.240.0.255", "10.241.0.2"} {
		c := b.Connection
		c.Address = addr
		if c.validate(b.Config) {
			t.Fatal("接受保留或其他子网地址")
		}
	}
}
func TestCNIResultContract(t *testing.T) {
	b := binding{EnvironmentID: "env", InstanceID: "instance", Config: config()}
	raw := `{"interfaces":[{"name":"veth123"},{"name":"eth0","sandbox":"` + b.path() + `"}],"ips":[{"interface":1,"address":"10.240.0.2/24","gateway":"10.240.0.1"}]}`
	c, err := connection([]byte(raw), b)
	if err != nil || c.Device != "veth123" {
		t.Fatal(c, err)
	}
	for _, bad := range []string{strings.Replace(raw, b.path(), "/run/netns/foreign", 1), strings.Replace(raw, `"interface":1`, `"interface":0`, 1), strings.Replace(raw, "10.240.0.1", "10.240.0.254", 1)} {
		if _, err := connection([]byte(bad), b); err == nil {
			t.Fatal("接受错误 CNI 归属")
		}
	}
	var cfg map[string]any
	if json.Unmarshal(cni(b), &cfg) != nil || cfg["type"] != "ptp" || cfg["ipMasq"] != false {
		t.Fatal("CNI 配置错误")
	}
}

type fakeKernel struct {
	calls  []string
	fail   string
	exists bool
	guards []Config
}

func (k *fakeKernel) call(op string) error {
	k.calls = append(k.calls, op)
	if k.fail == op {
		return errors.New("故障注入")
	}
	return nil
}
func (k *fakeKernel) Create(context.Context, binding) (uint64, error) {
	if err := k.call("create"); err != nil {
		return 0, err
	}
	k.exists = true
	return 42, nil
}
func (k *fakeKernel) Attach(context.Context, binding) (Connection, error) {
	err := k.call("attach")
	return Connection{"veth123", "10.240.0.2", "10.240.0.1"}, err
}
func (k *fakeKernel) Guard(_ context.Context, b binding) error {
	k.guards = append(k.guards, b.Config)
	return k.call("guard")
}
func (k *fakeKernel) Detach(context.Context, binding) error { return k.call("detach") }
func (k *fakeKernel) Delete(_ context.Context, b binding) error {
	if b.NamespaceID == 0 && k.exists {
		return errors.New("缺少归属证据")
	}
	if err := k.call("delete"); err != nil {
		return err
	}
	k.exists = false
	return nil
}
func manager(t *testing.T) (*Manager, *fakeKernel) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	k := &fakeKernel{}
	return &Manager{root: root, kernel: k, read: func() (Config, error) { return config(), nil }}, k
}
func TestPersistedRecoveryAndImmutableSnapshot(t *testing.T) {
	m, k := manager(t)
	s := spec()
	k.fail = "attach"
	if a, err := m.Ensure(t.Context(), s); err == nil || a.Namespace != "" {
		t.Fatal("未就绪返回网络附件")
	}
	b, err := m.load(s)
	if err != nil || b.Stage != "attaching" {
		t.Fatal(b, err)
	}
	k.fail = ""
	m.read = func() (Config, error) { return Config{}, errors.New("配置已被管理员移除") }
	a, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(k.calls, []string{"create", "attach", "detach", "attach", "guard"}) {
		t.Fatal(k.calls)
	}
	data, err := os.ReadFile(a.Resolver)
	if err != nil || !strings.Contains(string(data), "nameserver 1.1.1.1") {
		t.Fatal(string(data), err)
	}
	info, _ := os.Stat(a.Resolver)
	if info.Mode().Perm() != 0644 {
		t.Fatal("沙箱用户无法读取 DNS")
	}
	if err := m.Check(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	if k.guards[len(k.guards)-1].Subnet != config().Subnet {
		t.Fatal("改变了旧实例配置")
	}
	if err := m.Remove(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	count := len(k.calls)
	if err := m.Remove(t.Context(), s); err != nil || len(k.calls) != count {
		t.Fatal("重复回收不幂等", err)
	}
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("复用了已回收实例")
	}
}
func TestGuardAndCleanupFailuresRemainRetryable(t *testing.T) {
	m, k := manager(t)
	s := spec()
	k.fail = "guard"
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("忽略防火墙失败")
	}
	b, _ := m.load(s)
	if b.Stage != "attached" {
		t.Fatal(b.Stage)
	}
	k.fail = ""
	if _, err := m.Ensure(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	k.fail = "delete"
	if m.Remove(t.Context(), s) == nil {
		t.Fatal("忽略清理失败")
	}
	b, _ = m.load(s)
	if b.Stage != "removing" {
		t.Fatal(b.Stage)
	}
	k.fail = ""
	if err := m.Remove(t.Context(), s); err != nil {
		t.Fatal(err)
	}
}
func TestCorruptOwnershipAndCreationGapAreNotAdopted(t *testing.T) {
	m, k := manager(t)
	s := spec()
	b := binding{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Config: config(), Stage: "planned"}
	if err := m.save(b); err != nil {
		t.Fatal(err)
	}
	k.exists = true
	if m.Remove(t.Context(), s) == nil {
		t.Fatal("接管了未确认的命名空间")
	}
	k.exists = false
	if err := m.Remove(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	b.Stage = "removing"
	b.NamespaceID = 42
	b.Connection = Connection{Device: "foreign; delete"}
	m.save(b)
	if m.Check(t.Context(), s) == nil || m.Remove(t.Context(), s) == nil {
		t.Fatal("接受损坏连接")
	}
	b.Connection = Connection{}
	b.EnvironmentID = "foreign"
	raw, _ := json.Marshal(b)
	name := binding{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID}.name()
	os.WriteFile(filepath.Join(m.root, name+".json"), raw, 0600)
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("接管其他实例")
	}
}
