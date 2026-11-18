package dockernet

import (
	"errors"
	"net/netip"
)

var privateRanges = [...]netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
}

func ValidatePrivateCIDRs(prefixes []netip.Prefix) error {
	if len(prefixes) > 64 {
		return errors.New("allow_private_cidrs 最多支持 64 个网段")
	}
	for _, p := range prefixes {
		if !p.IsValid() || p != p.Masked() || !privateCIDR(p) {
			return errors.New("allow_private_cidrs 仅允许规范的 RFC1918 IPv4 CIDR")
		}
	}
	return nil
}

func privateCIDR(p netip.Prefix) bool {
	for _, r := range privateRanges {
		if p.Bits() >= r.Bits() && r.Contains(p.Addr()) {
			return true
		}
	}
	return false
}
