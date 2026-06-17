package upstreamclient

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

var errBlockedUpstreamURL = errors.New("blocked upstream url")

var reservedRFC6890Prefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("fec0::/10"),
}

type hostResolver interface {
	LookupIP(ctx context.Context, network, host string) ([]net.IP, error)
}

func validateUpstreamURL(ctx context.Context, rawURL string, resolver hostResolver) error {
	_, _, err := resolveAndValidateUpstreamURL(ctx, rawURL, resolver)
	return err
}

func resolveAndValidateUpstreamURL(ctx context.Context, rawURL string, resolver hostResolver) (string, []netip.Addr, error) {
	if resolver == nil {
		resolver = net.DefaultResolver
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", nil, fmt.Errorf("%w: parse url: %v", errBlockedUpstreamURL, err)
	}
	host := parsedURL.Hostname()
	if host == "" {
		return "", nil, fmt.Errorf("%w: empty host", errBlockedUpstreamURL)
	}
	addrs, err := resolveAndValidateHost(ctx, host, resolver)
	if err != nil {
		return "", nil, err
	}
	return host, addrs, nil
}

func resolveAndValidateHost(ctx context.Context, host string, resolver hostResolver) ([]netip.Addr, error) {
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	if strings.EqualFold(host, "localhost") || strings.EqualFold(host, "localhost.") {
		return nil, fmt.Errorf("%w: disallowed host %q", errBlockedUpstreamURL, host)
	}
	if strings.Contains(host, ":") && strings.Contains(host, "%") {
		return nil, fmt.Errorf("%w: disallowed scoped ipv6 host %q", errBlockedUpstreamURL, host)
	}
	if ip, ok := parseLiteralIP(host); ok {
		if isPrivateLikeIP(ip) {
			return nil, fmt.Errorf("%w: disallowed ip %q", errBlockedUpstreamURL, ip.String())
		}
		return []netip.Addr{ip}, nil
	}
	if ip, ok := parseNonCanonicalIPv4Literal(host); ok {
		if isPrivateLikeIP(ip) {
			return nil, fmt.Errorf("%w: disallowed ip %q", errBlockedUpstreamURL, ip.String())
		}
		return []netip.Addr{ip}, nil
	}

	ips, err := resolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("%w: dns resolve failed for %q: %v", errBlockedUpstreamURL, host, err)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("%w: dns resolve empty for %q", errBlockedUpstreamURL, host)
	}

	result := make([]netip.Addr, 0, len(ips))
	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip)
		if !ok {
			return nil, fmt.Errorf("%w: invalid resolved ip for %q", errBlockedUpstreamURL, host)
		}
		unmapped := addr.Unmap()
		if isPrivateLikeIP(unmapped) {
			return nil, fmt.Errorf("%w: resolved disallowed ip %q for %q", errBlockedUpstreamURL, addr.String(), host)
		}
		result = append(result, unmapped)
	}
	return result, nil
}

func parseLiteralIP(host string) (netip.Addr, bool) {
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.Unmap(), true
}

func parseNonCanonicalIPv4Literal(host string) (netip.Addr, bool) {
	if strings.Contains(host, ":") || host == "" {
		return netip.Addr{}, false
	}
	parts := strings.Split(host, ".")
	if len(parts) == 0 || len(parts) > 4 {
		return netip.Addr{}, false
	}
	values := make([]uint32, 0, len(parts))
	for _, part := range parts {
		if !isDecimalDigits(part) && !isHexNumber(part) && !isOctalNumber(part) {
			return netip.Addr{}, false
		}
		v, err := strconv.ParseUint(part, 0, 32)
		if err != nil {
			return netip.Addr{}, false
		}
		values = append(values, uint32(v))
	}

	var n uint32
	switch len(values) {
	case 1:
		n = values[0]
	case 2:
		if values[0] > 0xFF || values[1] > 0xFFFFFF {
			return netip.Addr{}, false
		}
		n = values[0]<<24 | values[1]
	case 3:
		if values[0] > 0xFF || values[1] > 0xFF || values[2] > 0xFFFF {
			return netip.Addr{}, false
		}
		n = values[0]<<24 | values[1]<<16 | values[2]
	case 4:
		for _, v := range values {
			if v > 0xFF {
				return netip.Addr{}, false
			}
		}
		n = values[0]<<24 | values[1]<<16 | values[2]<<8 | values[3]
	default:
		return netip.Addr{}, false
	}
	return netip.AddrFrom4([4]byte{byte(n >> 24), byte(n >> 16), byte(n >> 8), byte(n)}), true
}

func isDecimalDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return len(s) > 0
}

func isHexNumber(s string) bool {
	if len(s) < 3 || !(strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X")) {
		return false
	}
	for i := 2; i < len(s); i++ {
		ch := s[i]
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') {
			continue
		}
		return false
	}
	return true
}

func isOctalNumber(s string) bool {
	if len(s) < 2 || s[0] != '0' {
		return false
	}
	for i := 1; i < len(s); i++ {
		if s[i] < '0' || s[i] > '7' {
			return false
		}
	}
	return true
}

func isPrivateLikeIP(ip netip.Addr) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	for _, prefix := range reservedRFC6890Prefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}
