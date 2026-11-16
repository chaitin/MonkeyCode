package vmnet

import (
	"context"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
)

func networkFixture(t *testing.T) *Manager {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	rate := firecracker.Rate{Bandwidth: firecracker.Bucket{Size: 1 << 20, RefillMS: 100}, Operations: firecracker.Bucket{Size: 100, RefillMS: 100}}
	m, err := New(Config{Root: filepath.Join(root, "network"), GuestPool: netip.MustParsePrefix("172.30.0.0/16"), LinkPool: netip.MustParsePrefix("172.29.0.0/16"), DNS: []netip.Addr{netip.MustParseAddr("1.1.1.1")}, Rate: rate})
	if err != nil {
		t.Fatal(err)
	}
	return m
}
func TestNetworkPlanAndRules(t *testing.T) {
	m := networkFixture(t)
	id := strings.Repeat("a", 64)
	lease := m.plan(id, 10)
	if lease.UID != 100010 || !strings.Contains(lease.BootArgs, "172.30.0.42::172.30.0.41") || lease.Namespace != "/run/netns/mfc-"+id[:16] {
		t.Fatal(lease)
	}
	rules := m.rules(record{ID: id, Slot: 10, Ready: true, Lease: lease})
	for _, expected := range []string{"meta nfproto != ipv4 drop", "ip saddr != 172.30.0.42 drop", "fib daddr type local drop", "udp dport 53 accept", "100.100.100.200/32", "168.63.129.16/32", "ct state established,related accept", "masquerade"} {
		if !strings.Contains(rules, expected) {
			t.Fatalf("缺少隔离规则: %s", expected)
		}
	}
}
func TestNetworkConfigRejectsUnsafeValues(t *testing.T) {
	for _, change := range []func(*Config){
		func(c *Config) { c.LinkPool = c.GuestPool }, func(c *Config) { c.GuestPool = netip.MustParsePrefix("8.8.0.0/16") }, func(c *Config) { c.DNS = []netip.Addr{netip.MustParseAddr("169.254.169.254")} }, func(c *Config) { c.DNS = []netip.Addr{netip.MustParseAddr("10.0.0.1")} }, func(c *Config) { c.Exceptions = []Exception{{IP: netip.MustParseAddr("100.100.100.200"), Port: 80}} },
	} {
		m := networkFixture(t)
		c := m.config
		change(&c)
		if _, err := New(c); err == nil {
			t.Fatal("接受了不安全网络配置")
		}
	}
}
func TestRouteConflictStopsBeforeMutation(t *testing.T) {
	m := networkFixture(t)
	calls := 0
	m.run = func(ctx context.Context, name string, args []string, input string) ([]byte, error) {
		calls++
		if name != "ip" || strings.Join(args, " ") != "-j route show table all" {
			t.Fatal("路由检查前修改了网络")
		}
		return []byte(`[{"dst":"172.30.0.0/16"},{"dst":"default"}]`), nil
	}
	if _, err := m.Prepare(t.Context(), strings.Repeat("a", 64)); err == nil {
		t.Fatal("未拒绝地址冲突")
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	if _, err := os.Stat(m.registry()); !os.IsNotExist(err) {
		t.Fatal("冲突后留下分配记录", err)
	}
}
func TestNetworkRegistryRejectsChangedOwnership(t *testing.T) {
	m := networkFixture(t)
	id := strings.Repeat("a", 64)
	lease := m.plan(id, 1)
	lease.UID++
	if err := m.save(map[string]record{id: {ID: id, Slot: 1, Ready: true, Lease: lease}}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.load(); err == nil {
		t.Fatal("接受归属被更改的网络")
	}
}
