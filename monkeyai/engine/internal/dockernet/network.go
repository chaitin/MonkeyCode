package dockernet

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
)

var hexID = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Network struct {
	ID                   string `json:"Id"`
	Name, Driver         string
	Internal, EnableIPv6 bool
	Labels, Options      map[string]string
	IPAM                 struct {
		Config []struct{ Subnet, Gateway string }
	}
	Containers map[string]struct{ Name string }
}

func (n Network) DNS() []string { return strings.Fields(n.Labels["io.monkeyai.dns"]) }
func validDNS(ip string) bool {
	a, err := netip.ParseAddr(ip)
	return err == nil && a.Is4() && a.IsGlobalUnicast() && !a.IsLoopback() && !a.IsLinkLocalUnicast() && ip != "100.100.100.200" && ip != "168.63.129.16"
}
func resolvers() []string {
	for _, path := range []string{"/run/systemd/resolve/resolv.conf", "/etc/resolv.conf"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		out := []string{}
		seen := map[string]bool{}
		for _, line := range strings.Split(string(raw), "\n") {
			f := strings.Fields(line)
			if len(f) >= 2 && f[0] == "nameserver" && validDNS(f[1]) && !seen[f[1]] {
				out = append(out, f[1])
				seen[f[1]] = true
				if len(out) == 3 {
					break
				}
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return []string{"1.1.1.1", "8.8.8.8"}
}
func (n Network) Resolver() string {
	out := ""
	for _, ip := range n.DNS() {
		out += "nameserver " + ip + "\n"
	}
	return out + "options timeout:2 attempts:2\n"
}
func (n Network) Bridge() string { return "br-" + n.ID[:12] }
func (n Network) validate(name, fingerprint, containerName string) error {
	if !hexID.MatchString(n.ID) || n.Name != name || n.Driver != "bridge" || n.Internal || n.EnableIPv6 || n.Labels[dockerapi.Owner] != "engine" || n.Labels["io.monkeyai.spec"] != fingerprint || n.Options["com.docker.network.bridge.enable_icc"] != "false" || n.Options["com.docker.network.bridge.enable_ip_masquerade"] != "true" || n.Options["com.docker.network.bridge.name"] != "" || len(n.IPAM.Config) != 1 {
		return errors.New("Docker 网络归属或配置不一致")
	}
	p, err := netip.ParsePrefix(n.IPAM.Config[0].Subnet)
	if err != nil || !p.Addr().Is4() || !p.Addr().IsPrivate() {
		return errors.New("Docker 网络未分配私有 IPv4 网段")
	}
	if len(n.DNS()) < 1 || len(n.DNS()) > 3 {
		return errors.New("Docker 网络 DNS 配置无效")
	}
	for _, ip := range n.DNS() {
		if !validDNS(ip) {
			return errors.New("Docker 网络 DNS 地址无效")
		}
	}
	if len(n.Containers) > 1 {
		return errors.New("Docker 网络接入了额外容器")
	}
	for _, c := range n.Containers {
		if containerName == "" || c.Name != containerName {
			return errors.New("Docker 网络接入了未知容器")
		}
	}
	return nil
}
func Inspect(ctx context.Context, c *dockerapi.Client, name, fingerprint, containerName string) (Network, error) {
	var n Network
	err := c.Do(ctx, "GET", "/networks/"+dockerapi.Escape(name), nil, &n)
	if err == nil {
		err = n.validate(name, fingerprint, containerName)
	}
	return n, err
}
func Ensure(ctx context.Context, c *dockerapi.Client, name, fingerprint, containerName string) (Network, error) {
	n, err := Inspect(ctx, c, name, fingerprint, containerName)
	if dockerapi.NotFound(err) {
		body := map[string]any{"Name": name, "Driver": "bridge", "CheckDuplicate": true, "EnableIPv6": false, "Labels": map[string]string{dockerapi.Owner: "engine", "io.monkeyai.spec": fingerprint, "io.monkeyai.dns": strings.Join(resolvers(), " ")}, "Options": map[string]string{"com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.enable_ip_masquerade": "true"}}
		if err = c.Do(ctx, "POST", "/networks/create", body, nil); err != nil {
			return n, err
		}
		n, err = Inspect(ctx, c, name, fingerprint, containerName)
	}
	if err != nil {
		return n, err
	}
	return n, Guard(ctx, n, fingerprint)
}
func run(ctx context.Context, args []string, input string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "nft", args...)
	cmd.Stdin = strings.NewReader(input)
	var out bytes.Buffer
	cmd.Stdout = &out
	// nft 输出仅来自受控规则和系统查询，不包含容器日志。
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("nftables 操作失败: %w", err)
	}
	if out.Len() > 4<<20 {
		return nil, errors.New("nftables 输出过大")
	}
	return out.Bytes(), nil
}
func table(n Network) string { return "maed_" + n.ID[:20] }
func exists(ctx context.Context, n Network, fingerprint string) (bool, error) {
	raw, err := run(ctx, []string{"-j", "list", "tables"}, "")
	if err != nil {
		return false, err
	}
	var list struct {
		Nftables []struct {
			Table *struct{ Family, Name string }
		}
	}
	if json.Unmarshal(raw, &list) != nil {
		return false, errors.New("nftables 表清单无效")
	}
	for _, v := range list.Nftables {
		if v.Table != nil && v.Table.Name == table(n) && v.Table.Family == "inet" {
			raw, err = run(ctx, []string{"-nn", "list", "table", "inet", table(n)}, "")
			if err != nil {
				return false, err
			}
			head := strings.SplitN(string(raw), "chain ", 2)[0]
			if !strings.Contains(head, fmt.Sprintf("comment %q", "monkeyai-docker-"+fingerprint)) {
				return false, errors.New("拒绝接管未知防火墙表")
			}
			return true, nil
		}
	}
	return false, nil
}

const denied = "0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4, 100.100.100.200/32, 168.63.129.16/32"

func rules(n Network, fingerprint string) string {
	t, b := table(n), n.Bridge()
	dns := ""
	for _, ip := range n.DNS() {
		dns += fmt.Sprintf("ip daddr %s udp dport 53 accept\nip daddr %s tcp dport 53 accept\n", ip, ip)
	}
	return fmt.Sprintf(`add table inet %s
delete table inet %s
table inet %s {
 comment %q
 chain input { type filter hook input priority -200; policy accept; iifname %q counter drop; }
 chain output { type filter hook output priority -200; policy accept; oifname %q counter drop; }
 chain forward { type filter hook forward priority -200; policy accept; iifname %q jump outbound; oifname %q ct state established,related accept; oifname %q counter drop; }
 chain outbound {
 meta nfproto != ipv4 drop
 ip saddr != %s drop
 ct state invalid drop
 fib daddr type local drop
 %s
 ip daddr { %s } counter drop
 tcp dport { 22, 80, 443 } accept
 drop
 }
}
`, t, t, t, "monkeyai-docker-"+fingerprint, b, b, b, b, b, n.IPAM.Config[0].Subnet, dns, denied)
}
func Guard(ctx context.Context, n Network, fingerprint string) error {
	if _, err := exists(ctx, n, fingerprint); err != nil {
		return err
	}
	_, err := run(ctx, []string{"-f", "-"}, rules(n, fingerprint))
	return err
}
func Remove(ctx context.Context, c *dockerapi.Client, name, fingerprint, containerName string) error {
	n, err := Inspect(ctx, c, name, fingerprint, containerName)
	if dockerapi.NotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(n.Containers) != 0 {
		return errors.New("网络仍有关联容器，拒绝删除")
	}
	found, err := exists(ctx, n, fingerprint)
	if err != nil {
		return err
	}
	if found {
		if _, err = run(ctx, []string{"-f", "-"}, "delete table inet "+table(n)+"\n"); err != nil {
			return err
		}
	}
	return c.Do(ctx, "DELETE", "/networks/"+n.ID, nil, nil)
}
func Check(ctx context.Context) error {
	c := dockerapi.New(dockerapi.Socket)
	defer c.Close()
	i, err := c.Info(ctx)
	if err != nil {
		return err
	}
	if err = i.Validate(); err != nil {
		return err
	}
	if !i.IPv4Forwarding {
		return errors.New("Docker IPv4 转发未启用；请检查 Docker daemon 的网络配置")
	}
	_, err = run(ctx, []string{"-j", "list", "tables"}, "")
	return err
}
func Policies(ctx context.Context) []string {
	if Check(ctx) == nil {
		return []string{"isolated", "public-only"}
	}
	return []string{"isolated"}
}
