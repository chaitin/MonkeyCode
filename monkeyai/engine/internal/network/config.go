package network

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"os"
)

const ConfigPath = "/etc/monkeyai-engine/network.json"
const StatePath = "/var/lib/monkeyai-engine/control/network"

type Service struct {
	Address string   `json:"address"`
	Ports   []uint16 `json:"ports"`
}
type Config struct {
	Subnet         string    `json:"subnet"`
	DNS            []string  `json:"dns"`
	PublicTCPPorts []uint16  `json:"public_tcp_ports"`
	Deny           []string  `json:"deny_cidrs"`
	Services       []Service `json:"services"`
}

var hard = prefixes("100.100.100.200/32", "168.63.129.16/32", "0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4")
var private = prefixes("10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16", "198.18.0.0/15")

func prefixes(values ...string) []netip.Prefix {
	out := make([]netip.Prefix, len(values))
	for i, v := range values {
		out[i] = netip.MustParsePrefix(v)
	}
	return out
}
func contains(list []netip.Prefix, ip netip.Addr) bool {
	for _, p := range list {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}
func ports(list []uint16) bool {
	if len(list) < 1 || len(list) > 32 {
		return false
	}
	seen := map[uint16]bool{}
	for _, p := range list {
		if p == 0 || p == 53 || p == 853 || seen[p] {
			return false
		}
		seen[p] = true
	}
	return true
}
func (c Config) Validate() error {
	subnet, err := netip.ParsePrefix(c.Subnet)
	if err != nil || !subnet.Addr().Is4() || subnet != subnet.Masked() || subnet.Bits() < 16 || subnet.Bits() > 24 || !subnet.Addr().IsPrivate() {
		return errors.New("网络地址池必须是 /16 至 /24 的规范私有 IPv4 网段")
	}
	if len(c.DNS) < 1 || len(c.DNS) > 3 || !ports(c.PublicTCPPorts) || len(c.Deny) > 128 || len(c.Services) > 32 {
		return errors.New("DNS、端口或访问规则数量无效")
	}
	seen := map[string]bool{}
	for _, v := range c.DNS {
		ip, e := netip.ParseAddr(v)
		if e != nil || !ip.Is4() || !ip.IsGlobalUnicast() || contains(hard, ip) || contains(private, ip) || seen[v] {
			return errors.New("DNS 必须是互不重复的公网 IPv4 地址")
		}
		seen[v] = true
	}
	for _, v := range c.Deny {
		p, e := netip.ParsePrefix(v)
		if e != nil || !p.Addr().Is4() || p != p.Masked() {
			return errors.New("拒绝列表必须是规范 IPv4 CIDR")
		}
	}
	seen = map[string]bool{}
	for _, s := range c.Services {
		ip, e := netip.ParseAddr(s.Address)
		if e != nil || !ip.Is4() || !ip.IsGlobalUnicast() || contains(hard, ip) || subnet.Contains(ip) || !ports(s.Ports) || seen[s.Address] {
			return errors.New("服务例外必须是固定 IPv4 地址和明确 TCP 端口，不能指向地址池或保留地址")
		}
		seen[s.Address] = true
	}
	return nil
}
func Decode(r io.Reader) (Config, error) {
	var c Config
	raw, err := io.ReadAll(io.LimitReader(r, (32<<10)+1))
	if err != nil {
		return c, err
	}
	if len(raw) > 32<<10 {
		return c, errors.New("网络配置超过 32 KiB")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, err
	}
	if d.Decode(new(any)) != io.EOF {
		return c, errors.New("网络配置必须是单个 JSON 对象")
	}
	return c, c.Validate()
}
func Read(path string) (Config, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return Config{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 32<<10 || info.Mode().Perm()&0077 != 0 {
		return Config{}, errors.New("网络配置必须是私有普通文件，不能使用符号链接")
	}
	if err := ownedFile(info); err != nil {
		return Config{}, err
	}
	f, err := os.Open(path)
	if err != nil {
		return Config{}, err
	}
	defer f.Close()
	return Decode(f)
}
