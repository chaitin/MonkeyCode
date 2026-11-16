package vmnet

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

type Exception struct {
	IP   netip.Addr
	Port uint16
}
type Config struct {
	Root       string
	GuestPool  netip.Prefix
	LinkPool   netip.Prefix
	DNS        []netip.Addr
	Exceptions []Exception
	Rate       firecracker.Rate
}
type record struct {
	ID    string                   `json:"id"`
	Slot  int                      `json:"slot"`
	Ready bool                     `json:"ready"`
	Lease firecracker.NetworkLease `json:"lease"`
}
type Manager struct {
	config Config
	run    func(context.Context, string, []string, string) ([]byte, error)
}

func New(c Config) (*Manager, error) {
	if !filepath.IsAbs(c.Root) || filepath.Clean(c.Root) != c.Root || c.Root == "/" {
		return nil, errors.New("网络状态目录无效")
	}
	for _, pool := range []netip.Prefix{c.GuestPool, c.LinkPool} {
		if !pool.IsValid() || !pool.Addr().Is4() || !pool.Addr().IsPrivate() || pool.Bits() != 16 || pool.Masked() != pool {
			return nil, errors.New("网络地址池必须为对齐的私有IPv4 /16网段")
		}
	}
	if c.GuestPool.Overlaps(c.LinkPool) || len(c.DNS) == 0 || len(c.DNS) > 3 {
		return nil, errors.New("地址池不能重叠，且须配置固定DNS")
	}
	for _, dns := range c.DNS {
		if !dns.Is4() || !dns.IsGlobalUnicast() || dns.IsPrivate() || deniedAddress(dns) {
			return nil, errors.New("DNS必须为获准公网IPv4地址")
		}
	}
	for _, ex := range c.Exceptions {
		if !ex.IP.Is4() || !ex.IP.IsGlobalUnicast() || ex.Port == 0 || ex.IP.IsLoopback() || ex.IP.IsLinkLocalUnicast() || ex.IP.String() == "100.100.100.200" || ex.IP.String() == "168.63.129.16" {
			return nil, errors.New("中心服务网络例外无效")
		}
	}
	if err := c.Rate.Validate(); err != nil {
		return nil, err
	}
	if err := storage.PrivateDir(c.Root); err != nil {
		return nil, err
	}
	c.DNS = append([]netip.Addr(nil), c.DNS...)
	c.Exceptions = append([]Exception(nil), c.Exceptions...)
	return &Manager{config: c, run: command}, nil
}
func command(ctx context.Context, name string, args []string, input string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
	cmd.Stdin = strings.NewReader(input)
	var out boundedOutput
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("隔离网络命令%s失败: %w", name, err)
	}
	if out.exceeded {
		return nil, errors.New("隔离网络命令输出超限")
	}
	return out.data, nil
}

type boundedOutput struct {
	data     []byte
	exceeded bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	left := (1 << 20) - len(b.data)
	if len(p) > left {
		b.exceeded = true
		p = p[:left]
	}
	b.data = append(b.data, p...)
	return n, nil
}
func validID(id string) bool {
	if len(id) != 64 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'f' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}
func slotIP(pool netip.Prefix, slot, offset int) netip.Addr {
	raw := pool.Addr().As4()
	base := binary.BigEndian.Uint32(raw[:])
	binary.BigEndian.PutUint32(raw[:], base+uint32(slot*4+offset))
	return netip.AddrFrom4(raw)
}
func (m *Manager) registry() string { return filepath.Join(m.config.Root, "allocations.json") }
func (m *Manager) load() (map[string]record, error) {
	path := m.registry()
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]record{}, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 8<<20 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("网络分配记录不安全")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var all map[string]record
	if json.Unmarshal(raw, &all) != nil || all == nil {
		return nil, errors.New("网络分配记录损坏")
	}
	used := map[int]bool{}
	for id, r := range all {
		if !validID(id) || r.ID != id || r.Slot < 1 || r.Slot >= 16384 || used[r.Slot] || r.Lease != m.plan(id, r.Slot) {
			return nil, errors.New("网络分配身份或地址不一致")
		}
		used[r.Slot] = true
	}
	return all, nil
}
func (m *Manager) save(all map[string]record) error {
	raw, err := json.Marshal(all)
	if err != nil {
		return err
	}
	return control.Write(m.registry(), raw, 0600)
}
func (m *Manager) plan(id string, slot int) firecracker.NetworkLease {
	guest := slotIP(m.config.GuestPool, slot, 2)
	gateway := slotIP(m.config.GuestPool, slot, 1)
	return firecracker.NetworkLease{Namespace: "/run/netns/mfc-" + id[:16], UID: uint32(100000 + slot), BootArgs: "ip=" + guest.String() + "::" + gateway.String() + ":255.255.255.252::eth0:off", Interface: firecracker.Network{ID: "eth0", TAP: "tap0", MAC: fmt.Sprintf("02:fc:%02x:%02x:00:01", slot>>8, slot&255), RX: m.config.Rate, TX: m.config.Rate}}
}
func (m *Manager) Prepare(ctx context.Context, id string) (firecracker.NetworkLease, error) {
	if !validID(id) {
		return firecracker.NetworkLease{}, errors.New("网络环境标识无效")
	}
	unlock, err := control.Lock(filepath.Join(m.config.Root, "network.lock"))
	if err != nil {
		return firecracker.NetworkLease{}, err
	}
	defer unlock()
	all, err := m.load()
	if err != nil {
		return firecracker.NetworkLease{}, err
	}
	if r, ok := all[id]; ok {
		if !r.Ready {
			return r.Lease, errors.New("存在未完成网络准备，拒绝接管残留")
		}
		return r.Lease, m.Verify(ctx, id, r.Lease)
	}
	used := map[int]bool{}
	for _, r := range all {
		used[r.Slot] = true
		if r.ID[:16] == id[:16] {
			return firecracker.NetworkLease{}, errors.New("网络资源短标识冲突")
		}
	}
	slot := 0
	for candidate := 1; candidate < 16384; candidate++ {
		if !used[candidate] {
			slot = candidate
			break
		}
	}
	if slot == 0 {
		return firecracker.NetworkLease{}, errors.New("网络地址池耗尽")
	}
	if err := m.checkRoutes(ctx, slot); err != nil {
		return firecracker.NetworkLease{}, err
	}
	r := record{ID: id, Slot: slot, Lease: m.plan(id, slot)}
	// 在修改内核资源前登记，失败后不会把半成品当成安全网络。
	all[id] = r
	if err := m.save(all); err != nil {
		return r.Lease, err
	}
	namespace := filepath.Base(r.Lease.Namespace)
	host := "mfh" + id[:10]
	peer := "mfp" + id[:10]
	if _, err := m.run(ctx, "ip", []string{"netns", "add", namespace}, ""); err != nil {
		return r.Lease, err
	}
	commands := [][]string{
		{"link", "add", host, "type", "veth", "peer", "name", peer},
		{"link", "set", "dev", host, "alias", "monkeyai:" + id},
		{"link", "set", peer, "netns", namespace},
		{"addr", "add", slotIP(m.config.LinkPool, slot, 1).String() + "/30", "dev", host},
		{"link", "set", host, "up"},
		{"-n", namespace, "link", "set", "lo", "up"},
		{"-n", namespace, "addr", "add", slotIP(m.config.LinkPool, slot, 2).String() + "/30", "dev", peer},
		{"-n", namespace, "link", "set", peer, "up"},
		{"netns", "exec", namespace, "ip", "tuntap", "add", "dev", "tap0", "mode", "tap", "user", strconv.FormatUint(uint64(r.Lease.UID), 10)},
		{"-n", namespace, "addr", "add", slotIP(m.config.GuestPool, slot, 1).String() + "/30", "dev", "tap0"},
		{"-n", namespace, "link", "set", "tap0", "up"},
		{"-n", namespace, "route", "add", "default", "via", slotIP(m.config.LinkPool, slot, 1).String()},
		{"route", "add", slotIP(m.config.GuestPool, slot, 2).String() + "/32", "via", slotIP(m.config.LinkPool, slot, 2).String(), "dev", host},
	}
	// 先装宿主防火墙，再启用命名空间内路由；默认拒绝环境出口。
	if _, err := m.run(ctx, "nft", []string{"-f", "-"}, m.rules(r)); err != nil {
		return r.Lease, err
	}
	for _, args := range commands {
		if _, err := m.run(ctx, "ip", args, ""); err != nil {
			return r.Lease, err
		}
	}
	if _, err := m.run(ctx, "ip", []string{"netns", "exec", namespace, "sysctl", "-q", "-w", "net.ipv4.ip_forward=1", "net.ipv6.conf.all.disable_ipv6=1"}, ""); err != nil {
		return r.Lease, err
	}
	all[id] = record{ID: id, Slot: slot, Ready: true, Lease: r.Lease}
	if err := m.save(all); err != nil {
		return r.Lease, err
	}
	return r.Lease, m.Verify(ctx, id, r.Lease)
}
func (m *Manager) checkRoutes(ctx context.Context, slot int) error {
	raw, err := m.run(ctx, "ip", []string{"-j", "route", "show", "table", "all"}, "")
	if err != nil {
		return err
	}
	var routes []struct {
		Dst string `json:"dst"`
	}
	if json.Unmarshal(raw, &routes) != nil {
		return errors.New("宿主路由查询无效")
	}
	for _, route := range routes {
		if route.Dst == "default" || route.Dst == "" {
			continue
		}
		p, err := netip.ParsePrefix(route.Dst)
		if err != nil {
			a, e := netip.ParseAddr(route.Dst)
			if e != nil {
				return errors.New("宿主路由地址无效")
			}
			p = netip.PrefixFrom(a, a.BitLen())
		}
		for _, pool := range []netip.Prefix{m.config.GuestPool, m.config.LinkPool} {
			candidate := netip.PrefixFrom(slotIP(pool, slot, 0), 30)
			if p.Overlaps(candidate) {
				return errors.New("环境网络地址与宿主现有路由冲突")
			}
		}
	}
	return nil
}

const denied = "0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 192.0.0.0/24, 192.0.2.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4, 100.100.100.200/32, 168.63.129.16/32"

func deniedAddress(ip netip.Addr) bool {
	for _, raw := range strings.Split(denied, ",") {
		p := netip.MustParsePrefix(strings.TrimSpace(raw))
		if p.Contains(ip) {
			return true
		}
	}
	return false
}
func (m *Manager) rules(r record) string {
	id := r.ID
	table := "mafc_" + id[:16]
	host := "mfh" + id[:10]
	address := slotIP(m.config.GuestPool, r.Slot, 2).String()
	allowed := ""
	for _, dns := range m.config.DNS {
		allowed += fmt.Sprintf("ip daddr %s udp dport 53 accept\nip daddr %s tcp dport 53 accept\n", dns, dns)
	}
	for _, ex := range m.config.Exceptions {
		allowed += fmt.Sprintf("ip daddr %s tcp dport %d accept\n", ex.IP, ex.Port)
	}
	return fmt.Sprintf(`table inet %s {
 comment "monkeyai-firecracker-%s"
 chain input { type filter hook input priority -200; policy accept; iifname "%s" drop; }
 chain output { type filter hook output priority -200; policy accept; oifname "%s" drop; }
 chain forward { type filter hook forward priority -200; policy accept; iifname "%s" jump outbound; oifname "%s" ct state established,related accept; oifname "%s" drop; }
 chain outbound { meta nfproto != ipv4 drop; ip saddr != %s drop; ct state invalid drop; fib daddr type local drop;
 %s
 ip daddr { %s } drop;
 tcp dport { 22, 80, 443 } accept; drop;
 }
 chain nat { type nat hook postrouting priority srcnat; policy accept; ip saddr %s masquerade; }
}
`, table, id, host, host, host, host, host, address, allowed, denied, address)
}
func (m *Manager) Verify(ctx context.Context, id string, lease firecracker.NetworkLease) error {
	if !validID(id) {
		return errors.New("网络标识无效")
	}
	all, err := m.load()
	if err != nil {
		return err
	}
	r, ok := all[id]
	if !ok || !r.Ready || r.Lease != lease {
		return errors.New("网络状态或归属不符")
	}
	raw, err := m.run(ctx, "ip", []string{"-j", "link", "show", "dev", "mfh" + id[:10]}, "")
	if err != nil {
		return err
	}
	var links []struct {
		Alias string `json:"ifalias"`
		Name  string `json:"ifname"`
	}
	if json.Unmarshal(raw, &links) != nil || len(links) != 1 || links[0].Alias != "monkeyai:"+id {
		return errors.New("拒绝接管未知veth")
	}
	raw, err = m.run(ctx, "nft", []string{"-j", "list", "table", "inet", "mafc_" + id[:16]}, "")
	if err != nil {
		return err
	}
	var tables struct {
		Entries []struct {
			Table *struct{ Name, Comment string } `json:"table"`
		} `json:"nftables"`
	}
	if json.Unmarshal(raw, &tables) != nil {
		return errors.New("防火墙状态不可解析")
	}
	owned := false
	for _, entry := range tables.Entries {
		if entry.Table != nil && entry.Table.Name == "mafc_"+id[:16] && entry.Table.Comment == "monkeyai-firecracker-"+id {
			owned = true
		}
	}
	if !owned {
		return errors.New("防火墙归属不符")
	}
	forwarding, err := os.ReadFile("/proc/sys/net/ipv4/ip_forward")
	if err != nil || strings.TrimSpace(string(forwarding)) != "1" {
		return errors.New("宿主未启用IPv4转发")
	}
	return nil
}
func (m *Manager) Remove(ctx context.Context, id string, lease firecracker.NetworkLease) error {
	if !validID(id) {
		return errors.New("网络标识无效")
	}
	unlock, err := control.Lock(filepath.Join(m.config.Root, "network.lock"))
	if err != nil {
		return err
	}
	defer unlock()
	all, err := m.load()
	if err != nil {
		return err
	}
	r, ok := all[id]
	if !ok {
		return nil
	}
	if r.Lease != lease || !r.Ready {
		return errors.New("网络清理归属不符或准备未完成")
	}
	if err := m.Verify(ctx, id, lease); err != nil {
		return err
	}
	namespace := filepath.Base(lease.Namespace)
	pids, err := m.run(ctx, "ip", []string{"netns", "pids", namespace}, "")
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(pids)) != "" {
		return errors.New("网络命名空间仍有进程")
	}
	if _, err := m.run(ctx, "ip", []string{"link", "delete", "mfh" + id[:10]}, ""); err != nil {
		return err
	}
	if _, err := m.run(ctx, "ip", []string{"netns", "delete", namespace}, ""); err != nil {
		return err
	}
	if _, err := m.run(ctx, "nft", []string{"delete", "table", "inet", "mafc_" + id[:16]}, ""); err != nil {
		return err
	}
	delete(all, id)
	return m.save(all)
}
