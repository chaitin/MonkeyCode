package network

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"regexp"
	"sort"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

var device = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,14}$`)

type Connection struct {
	Device  string `json:"device"`
	Address string `json:"address"`
	Gateway string `json:"gateway"`
}

func (c Connection) validate(config Config) bool {
	subnet := netip.MustParsePrefix(config.Subnet)
	ip, e := netip.ParseAddr(c.Address)
	gw, g := netip.ParseAddr(c.Gateway)
	return e == nil && g == nil && device.MatchString(c.Device) && ip.Is4() && gw.Is4() && subnet.Contains(ip) && subnet.Contains(ip.Next()) && subnet.Contains(gw) && ip != gw && ip != subnet.Addr() && gw == subnet.Addr().Next()
}
func table(b binding) string { return "mae_" + storage.Key(b.EnvironmentID + "\n" + b.InstanceID)[:20] }
func owner(b binding) string {
	raw, _ := json.Marshal(struct {
		Environment, Instance string
		Config                Config
	}{b.EnvironmentID, b.InstanceID, b.Config})
	return "monkeyai-" + storage.Key(string(raw))
}
func portSet(values []uint16) string {
	out := make([]string, len(values))
	for i, v := range values {
		out[i] = fmt.Sprint(v)
	}
	return "{ " + strings.Join(out, ", ") + " }"
}
func addressSet(values []string) string {
	values = append([]string(nil), values...)
	sort.Strings(values)
	return "{ " + strings.Join(values, ", ") + " }"
}
func prefixStrings(list []netip.Prefix) []string {
	out := make([]string, len(list))
	for i, p := range list {
		out[i] = p.String()
	}
	return out
}
func rules(b binding, routes []string) string {
	n, tag, c := table(b), owner(b), b.Connection
	var out strings.Builder
	// 同一个 nft 批次内重建自有表，事务提交前旧规则仍然有效。
	fmt.Fprintf(&out, "add table inet %s\ndelete table inet %s\ntable inet %s {\n comment %q\n", n, n, n, tag)
	fmt.Fprintf(&out, " chain input { type filter hook input priority -200; policy accept; iifname %q drop; }\n", c.Device)
	fmt.Fprintf(&out, " chain output { type filter hook output priority -200; policy accept; oifname %q drop; }\n", c.Device)
	fmt.Fprintf(&out, " chain forward { type filter hook forward priority -200; policy accept; iifname %q jump outbound; oifname %q ip daddr %s ct state established,related accept; oifname %q drop; }\n", c.Device, c.Device, c.Address, c.Device)
	fmt.Fprintf(&out, " chain outbound { meta nfproto != ipv4 drop; ip saddr != %s drop; ct state invalid drop; fib daddr type local drop; fib daddr type broadcast drop; fib daddr type multicast drop;\n", c.Address)
	fmt.Fprintf(&out, " ip daddr %s drop;\n", addressSet(prefixStrings(hard)))
	if len(b.Config.Deny) > 0 {
		fmt.Fprintf(&out, " ip daddr %s drop;\n", addressSet(b.Config.Deny))
	}
	for _, dns := range b.Config.DNS {
		fmt.Fprintf(&out, " ip daddr %s udp dport 53 accept; ip daddr %s tcp dport 53 accept;\n", dns, dns)
	}
	out.WriteString(" tcp dport { 53, 853 } drop; udp dport { 53, 853 } drop;\n")
	for _, s := range b.Config.Services {
		fmt.Fprintf(&out, " ip daddr %s tcp dport %s accept;\n", s.Address, portSet(s.Ports))
	}
	denied := append(prefixStrings(private), routes...)
	fmt.Fprintf(&out, " ip daddr %s drop; tcp dport %s accept; drop;\n }\n", addressSet(denied), portSet(b.Config.PublicTCPPorts))
	fmt.Fprintf(&out, " chain nat { type nat hook postrouting priority 100; policy accept; iifname %q ip saddr %s masquerade; }\n}\n", c.Device, c.Address)
	fmt.Fprintf(&out, "add table netdev %s\ndelete table netdev %s\ntable netdev %s {\n comment %q\n chain ingress { type filter hook ingress device %q priority -500; policy drop; ether type arp arp saddr ip %s arp daddr ip %s accept; ether type ip ip saddr %s accept; }\n}\n", n, n, n, tag, c.Device, c.Address, c.Gateway, c.Address)
	return out.String()
}
func cni(b binding) []byte {
	cfg := map[string]any{"cniVersion": "1.0.0", "name": "monkeyai-public", "type": "ptp", "mtu": 1500, "ipMasq": false, "ipam": map[string]any{"type": "host-local", "dataDir": StatePath + "/ipam", "ranges": []any{[]any{map[string]string{"subnet": b.Config.Subnet}}}, "routes": []any{map[string]string{"dst": "0.0.0.0/0"}}}}
	raw, _ := json.Marshal(cfg)
	return raw
}
