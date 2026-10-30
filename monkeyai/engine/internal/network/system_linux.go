package network

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type local struct{}

func ownedFile(info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 {
		return errors.New("网络配置必须由 root 所有")
	}
	return nil
}

type bounded struct {
	bytes.Buffer
	overflow bool
}

func (b *bounded) Write(p []byte) (int, error) {
	n := len(p)
	limit := (1 << 20) - b.Len()
	if n > limit {
		b.overflow = true
		p = p[:max(0, limit)]
	}
	b.Buffer.Write(p)
	return n, nil
}
func run(ctx context.Context, name string, args []string, input []byte, env ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = bytes.NewReader(input)
	cmd.Env = append([]string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}, env...)
	cmd.WaitDelay = time.Second
	var out bounded
	cmd.Stdout = &out
	var stderr bounded
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("网络命令 %s 执行失败: %w: %s", filepath.Base(name), err, strings.TrimSpace(stderr.String()[:min(stderr.Len(), 2048)]))
	}
	if out.overflow {
		return nil, errors.New("网络命令输出超过限制")
	}
	return out.Bytes(), nil
}
func ip(ctx context.Context, args ...string) ([]byte, error) { return run(ctx, "ip", args, nil) }
func namespaceID(path string) (uint64, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() {
		return 0, errors.New("网络命名空间挂载不是普通文件")
	}
	var fs unix.Statfs_t
	if err := unix.Statfs(path, &fs); err != nil {
		return 0, err
	}
	if fs.Type != unix.NSFS_MAGIC {
		return 0, errors.New("网络命名空间挂载类型无效")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 {
		return 0, errors.New("网络命名空间所有者无效")
	}
	return stat.Ino, nil
}
func verifyNamespace(b binding, missing bool) error {
	id, err := namespaceID(b.path())
	if missing && errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if id != b.NamespaceID || id == 0 {
		return errors.New("网络命名空间身份不一致")
	}
	return nil
}
func (local) Create(ctx context.Context, b binding) (uint64, error) {
	if _, err := os.Lstat(b.path()); !errors.Is(err, os.ErrNotExist) {
		return 0, errors.New("同名网络命名空间已存在或不可核对，拒绝接管")
	}
	if _, err := ip(ctx, "netns", "add", b.name()); err != nil {
		return 0, err
	}
	return namespaceID(b.path())
}
func plugin(ctx context.Context, b binding, command string) ([]byte, error) {
	ns := b.path()
	if command == "DEL" {
		if _, err := os.Lstat(ns); errors.Is(err, os.ErrNotExist) {
			ns = ""
		}
	}
	return run(ctx, "/opt/monkeyai-engine/current/cni/ptp", nil, cni(b), "CNI_COMMAND="+command, "CNI_CONTAINERID="+b.name(), "CNI_NETNS="+ns, "CNI_IFNAME=eth0", "CNI_PATH=/opt/monkeyai-engine/current/cni", "CNI_ARGS=")
}
func (local) Attach(ctx context.Context, b binding) (Connection, error) {
	// ptp 会尝试启用转发，先核对管理员已开启以及地址池无冲突。
	if _, err := routes(ctx, b.Config); err != nil {
		return Connection{}, err
	}
	if err := verifyNamespace(b, false); err != nil {
		return Connection{}, err
	}
	if _, err := ip(ctx, "-n", b.name(), "link", "set", "lo", "up"); err != nil {
		return Connection{}, err
	}
	raw, err := plugin(ctx, b, "ADD")
	if err != nil {
		return Connection{}, err
	}
	c, err := connection(raw, b)
	if err != nil {
		return Connection{}, err
	}
	if _, err := ip(ctx, "link", "set", "dev", c.Device, "alias", owner(b)); err != nil {
		return c, err
	}
	return c, nil
}

type link struct {
	Name  string `json:"ifname"`
	Alias string `json:"ifalias"`
}

func links(ctx context.Context) (map[string]string, error) {
	raw, err := ip(ctx, "-j", "link", "show")
	if err != nil {
		return nil, err
	}
	var list []link
	if json.Unmarshal(raw, &list) != nil {
		return nil, errors.New("宿主接口清单无效")
	}
	out := map[string]string{}
	for _, l := range list {
		out[l.Name] = l.Alias
	}
	return out, nil
}
func routes(ctx context.Context, c Config) ([]string, error) {
	if raw, err := os.ReadFile("/proc/sys/net/ipv4/ip_forward"); err != nil || strings.TrimSpace(string(raw)) != "1" {
		return nil, errors.New("公网网络需要管理员显式启用 IPv4 转发")
	}
	owned, err := links(ctx)
	if err != nil {
		return nil, err
	}
	raw, err := ip(ctx, "-j", "-4", "route", "show", "table", "all")
	if err != nil {
		return nil, err
	}
	var list []struct {
		Dst    string `json:"dst"`
		Device string `json:"dev"`
	}
	if json.Unmarshal(raw, &list) != nil {
		return nil, errors.New("宿主路由清单无效")
	}
	subnet := netip.MustParsePrefix(c.Subnet)
	seen := map[string]bool{}
	out := []string{}
	for _, r := range list {
		if r.Dst == "default" || r.Dst == "0.0.0.0/0" || r.Dst == "" {
			continue
		}
		p, e := netip.ParsePrefix(r.Dst)
		if e != nil {
			if addr, e := netip.ParseAddr(r.Dst); e == nil && addr.Is4() {
				p = netip.PrefixFrom(addr, 32)
			} else {
				return nil, errors.New("宿主包含不可解析路由")
			}
		}
		if !p.Addr().Is4() {
			return nil, errors.New("IPv4 路由清单包含其他地址族")
		}
		// 仅忽略已标记归属的环境 veth，其他相交路由都拒绝使用该地址池。
		alias := owned[r.Device]
		managed := strings.HasPrefix(alias, "monkeyai-") && len(alias) == len("monkeyai-")+64
		if p.Overlaps(subnet) && !managed {
			return nil, errors.New("网络地址池与宿主路由冲突")
		}
		if !managed && !seen[p.Masked().String()] {
			seen[p.Masked().String()] = true
			out = append(out, p.Masked().String())
		}
	}
	return out, nil
}

type nftTable struct {
	Family  string `json:"family"`
	Name    string `json:"name"`
	Comment string `json:"comment"`
}

func readTables(raw []byte) ([]nftTable, error) {
	var data struct {
		NFT []struct {
			Table *nftTable `json:"table"`
		} `json:"nftables"`
	}
	if json.Unmarshal(raw, &data) != nil || data.NFT == nil {
		return nil, errors.New("nftables 表清单无效")
	}
	out := []nftTable{}
	for _, v := range data.NFT {
		if v.Table != nil {
			out = append(out, *v.Table)
		}
	}
	return out, nil
}
func tableOwned(raw []byte, family string, b binding) bool {
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	return len(lines) >= 3 && strings.TrimSpace(lines[0]) == "table "+family+" "+table(b)+" {" && strings.TrimSpace(lines[1]) == fmt.Sprintf("comment %q", owner(b)) && strings.TrimSpace(lines[len(lines)-1]) == "}"
}
func tables(ctx context.Context, b binding) (map[string]bool, error) {
	raw, err := run(ctx, "nft", []string{"-j", "list", "tables"}, nil)
	if err != nil {
		return nil, err
	}
	list, err := readTables(raw)
	if err != nil {
		return nil, err
	}
	found := map[string]bool{}
	for _, t := range list {
		if t.Name != table(b) || (t.Family != "inet" && t.Family != "netdev") {
			continue
		}
		// list tables 不保证带 comment，必须查询完整表再核对归属。
		raw, err := run(ctx, "nft", []string{"-nn", "list", "table", t.Family, t.Name}, nil)
		if err != nil {
			return nil, err
		}
		// nft 1.0.x 的 JSON 输出会丢失表 comment，使用文本头部核对完整归属。
		if !tableOwned(raw, t.Family, b) {
			return nil, errors.New("同名防火墙表归属不一致")
		}
		found[t.Family] = true
	}
	return found, nil
}
func (local) Guard(ctx context.Context, b binding) error {
	if err := verifyNamespace(b, false); err != nil {
		return err
	}
	list, err := links(ctx)
	if err != nil {
		return err
	}
	if list[b.Connection.Device] != owner(b) {
		return errors.New("宿主 veth 归属不一致")
	}
	raw, err := ip(ctx, "-j", "-n", b.name(), "-4", "address", "show", "dev", "eth0")
	if err != nil {
		return err
	}
	var addresses []struct {
		Info []struct {
			Local string `json:"local"`
		} `json:"addr_info"`
	}
	if json.Unmarshal(raw, &addresses) != nil || len(addresses) != 1 || len(addresses[0].Info) != 1 || addresses[0].Info[0].Local != b.Connection.Address {
		return errors.New("环境网络地址与绑定记录不一致")
	}
	denied, err := routes(ctx, b.Config)
	if err != nil {
		return err
	}
	if _, err := tables(ctx, b); err != nil {
		return err
	}
	_, err = run(ctx, "nft", []string{"-f", "-"}, []byte(rules(b, denied)))
	return err
}
func (local) Detach(ctx context.Context, b binding) error {
	if err := verifyNamespace(b, true); err != nil {
		return err
	}
	if b.Connection.Device != "" {
		list, err := links(ctx)
		if err != nil {
			return err
		}
		if alias, ok := list[b.Connection.Device]; ok && alias != owner(b) {
			return errors.New("拒绝清理不属于当前实例的 veth")
		}
	}
	if _, err := plugin(ctx, b, "DEL"); err != nil {
		return err
	}
	if b.Connection.Device != "" {
		list, err := links(ctx)
		if err != nil {
			return err
		}
		if alias, ok := list[b.Connection.Device]; ok {
			if alias != owner(b) {
				return errors.New("veth 归属改变")
			}
			if _, err := ip(ctx, "link", "delete", b.Connection.Device); err != nil {
				return err
			}
		}
	}
	return nil
}
func (local) Delete(ctx context.Context, b binding) error {
	if err := verifyNamespace(b, true); err != nil {
		return err
	}
	found, err := tables(ctx, b)
	if err != nil {
		return err
	}
	var script strings.Builder
	for _, family := range []string{"netdev", "inet"} {
		if found[family] {
			fmt.Fprintf(&script, "delete table %s %s\n", family, table(b))
		}
	}
	if script.Len() > 0 {
		if _, err := run(ctx, "nft", []string{"-f", "-"}, []byte(script.String())); err != nil {
			return err
		}
	}
	if _, err := os.Lstat(b.path()); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	_, err = ip(ctx, "netns", "delete", b.name())
	return err
}
func Policies(ctx context.Context) []string {
	out := []string{"isolated"}
	cfg, err := Read(ConfigPath)
	if err != nil {
		return out
	}
	for _, name := range []string{"ip", "nft"} {
		if _, err := exec.LookPath(name); err != nil {
			return out
		}
	}
	for _, name := range []string{"ptp", "host-local"} {
		info, err := os.Stat("/opt/monkeyai-engine/current/cni/" + name)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&0111 == 0 {
			return out
		}
	}
	if _, err := routes(ctx, cfg); err != nil {
		return out
	}
	// 验证 netlink 查询可用，不在预检中修改防火墙。
	if _, err := run(ctx, "nft", []string{"-j", "list", "tables"}, nil); err != nil {
		return out
	}
	return append(out, "public-only")
}
