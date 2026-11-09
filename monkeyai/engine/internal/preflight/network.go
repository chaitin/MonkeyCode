package preflight

import (
	"net"
	"net/netip"
	"slices"
	"strings"
)

func hostInterface(i net.Interface) bool {
	if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
		return false
	}
	for _, prefix := range []string{"docker", "veth", "br-", "virbr", "cni", "flannel", "cali", "tunl"} {
		if strings.HasPrefix(i.Name, prefix) {
			return false
		}
	}
	return true
}

func networkIPs() (private, public []string) {
	interfaces, _ := net.Interfaces()
	for _, i := range interfaces {
		if !hostInterface(i) {
			continue
		}
		addresses, _ := i.Addrs()
		for _, address := range addresses {
			prefix, err := netip.ParsePrefix(address.String())
			if err != nil {
				continue
			}
			ip := prefix.Addr().Unmap()
			if !ip.IsGlobalUnicast() || ip.IsLoopback() {
				continue
			}
			if ip.IsPrivate() || netip.MustParsePrefix("100.64.0.0/10").Contains(ip) {
				private = append(private, ip.String())
			} else {
				public = append(public, ip.String())
			}
		}
	}
	slices.Sort(private)
	slices.Sort(public)
	private, public = slices.Compact(private), slices.Compact(public)
	return private[:min(len(private), 64)], public[:min(len(public), 64)]
}
