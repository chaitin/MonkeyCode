package netpolicy

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"strings"
)

type Reader func(context.Context) ([]netip.Prefix, error)

var ErrDenied = errors.New("目标地址被网络策略禁止访问")
var ErrUnavailable = errors.New("无法读取网络黑名单")

// A policy failure occurs before any request is sent to the provider.
func ModelErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrDenied):
		return "model_address_denied"
	case errors.Is(err, ErrUnavailable):
		return "model_network_unavailable"
	default:
		return ""
	}
}

func AllowedIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	cidrs := strings.TrimSpace(os.Getenv("MONKEYAI_MCP_ALLOWED_CIDRS"))
	if cidrs == "" {
		cidrs = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"
	}
	for s := range strings.SplitSeq(cidrs, ",") {
		p, err := netip.ParsePrefix(strings.TrimSpace(s))
		if err == nil && p.Contains(ip) {
			return true
		}
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "198.18.0.0/15"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast()
}

func (read Reader) Check(ctx context.Context, ips []netip.Addr) error {
	var blocked []netip.Prefix
	if read != nil {
		var err error
		blocked, err = read(ctx)
		if err != nil {
			return fmt.Errorf("%w: %w", ErrUnavailable, err)
		}
	}
	if len(ips) == 0 {
		return ErrDenied
	}
	for _, ip := range ips {
		if !ip.IsValid() || ip.Zone() != "" || !AllowedIP(ip) {
			return ErrDenied
		}
		for _, prefix := range blocked {
			if prefix.Contains(ip.Unmap()) {
				return ErrDenied
			}
		}
	}
	return nil
}
