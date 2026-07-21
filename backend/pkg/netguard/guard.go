package netguard

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrPrivateNetwork = errors.New("private network address is not allowed")

var reservedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("fec0::/10"),
	netip.MustParsePrefix("ff00::/8"),
}

type resolver interface {
	LookupIP(ctx context.Context, network, host string) ([]net.IP, error)
}

type Guard struct {
	enabled  bool
	resolver resolver
	dialer   *net.Dialer
}

func New(enabled bool) *Guard {
	return &Guard{
		enabled:  enabled,
		resolver: net.DefaultResolver,
		dialer: &net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		},
	}
}

func (g *Guard) Enabled() bool {
	return g != nil && g.enabled
}

func (g *Guard) ValidateURL(ctx context.Context, rawURL string) error {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported scheme %q", u.Scheme)
	}
	if u.Hostname() == "" {
		return errors.New("empty host")
	}
	if !g.Enabled() {
		return nil
	}
	_, err = g.resolveHost(ctx, u.Hostname())
	return err
}

func (g *Guard) HTTPClient(base *http.Client) *http.Client {
	if base == nil {
		base = &http.Client{}
	}
	client := *base
	if !g.Enabled() {
		return &client
	}
	transport, ok := base.Transport.(*http.Transport)
	if !ok {
		if base.Transport != nil {
			client.Transport = &validatingTransport{guard: g, transport: base.Transport}
			return &client
		}
		transport = http.DefaultTransport.(*http.Transport)
	}
	client.Transport = g.transport(transport)
	return &client
}

func (g *Guard) transport(base *http.Transport) http.RoundTripper {
	forceHTTP2 := shouldForceHTTP2(base)

	direct := base.Clone()
	direct.Proxy = nil
	direct.DialContext = g.dialContext
	direct.ForceAttemptHTTP2 = forceHTTP2

	proxied := base.Clone()
	proxied.DialContext = g.dialContext
	proxied.ForceAttemptHTTP2 = forceHTTP2
	return &guardedTransport{
		guard:   g,
		base:    base,
		direct:  direct,
		proxied: proxied,
	}
}

func shouldForceHTTP2(transport *http.Transport) bool {
	if transport.ForceAttemptHTTP2 {
		return true
	}
	if transport.Protocols != nil || transport.TLSNextProto != nil {
		return false
	}
	return transport.TLSClientConfig == nil &&
		transport.Dial == nil &&
		transport.DialContext == nil &&
		transport.DialTLS == nil &&
		transport.DialTLSContext == nil
}

type validatingTransport struct {
	guard     *Guard
	transport http.RoundTripper
}

func (t *validatingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if err := t.guard.ValidateURL(req.Context(), req.URL.String()); err != nil {
		return nil, err
	}
	return t.transport.RoundTrip(req)
}

type guardedTransport struct {
	guard   *Guard
	base    *http.Transport
	direct  *http.Transport
	proxied *http.Transport
}

func (t *guardedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if err := t.guard.ValidateURL(req.Context(), req.URL.String()); err != nil {
		return nil, err
	}
	if t.base.Proxy != nil {
		proxyURL, err := t.base.Proxy(req)
		if err != nil {
			return nil, err
		}
		if proxyURL != nil {
			return t.proxied.RoundTrip(req)
		}
	}
	return t.direct.RoundTrip(req)
}

func (g *Guard) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addrs, err := g.resolveHost(ctx, host)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, addr := range addrs {
		conn, dialErr := g.dialer.DialContext(ctx, network, net.JoinHostPort(addr.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no address resolved for %q", host)
	}
	return nil, lastErr
}

func (g *Guard) resolveHost(ctx context.Context, host string) ([]netip.Addr, error) {
	if strings.EqualFold(host, "localhost") || strings.EqualFold(host, "localhost.") {
		return nil, fmt.Errorf("%w: host %q", ErrPrivateNetwork, host)
	}
	if strings.Contains(host, ":") && strings.Contains(host, "%") {
		return nil, fmt.Errorf("%w: scoped ipv6 host %q", ErrPrivateNetwork, host)
	}
	if ip, ok := parseIP(host); ok {
		return validateAddrs(host, []netip.Addr{ip})
	}

	ips, err := g.resolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve host %q: %w", host, err)
	}
	addrs := make([]netip.Addr, 0, len(ips))
	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip)
		if !ok {
			return nil, fmt.Errorf("invalid address for host %q", host)
		}
		addrs = append(addrs, addr.Unmap())
	}
	return validateAddrs(host, addrs)
}

func validateAddrs(host string, addrs []netip.Addr) ([]netip.Addr, error) {
	if len(addrs) == 0 {
		return nil, fmt.Errorf("no address resolved for %q", host)
	}
	for _, addr := range addrs {
		if isPrivate(addr) {
			return nil, fmt.Errorf("%w: %s", ErrPrivateNetwork, addr)
		}
	}
	return addrs, nil
}

func parseIP(host string) (netip.Addr, bool) {
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.Unmap(), true
	}
	if strings.Contains(host, ":") || host == "" {
		return netip.Addr{}, false
	}
	parts := strings.Split(host, ".")
	if len(parts) == 0 || len(parts) > 4 {
		return netip.Addr{}, false
	}
	values := make([]uint32, 0, len(parts))
	for _, part := range parts {
		base := 10
		value := part
		if strings.HasPrefix(part, "0x") || strings.HasPrefix(part, "0X") {
			base = 16
			value = part[2:]
		} else if len(part) > 1 && part[0] == '0' {
			base = 8
			value = part[1:]
		}
		if value == "" {
			value = "0"
		}
		v, err := strconv.ParseUint(value, base, 32)
		if err != nil {
			return netip.Addr{}, false
		}
		values = append(values, uint32(v))
	}

	var value uint32
	switch len(values) {
	case 1:
		value = values[0]
	case 2:
		if values[0] > 0xff || values[1] > 0xffffff {
			return netip.Addr{}, false
		}
		value = values[0]<<24 | values[1]
	case 3:
		if values[0] > 0xff || values[1] > 0xff || values[2] > 0xffff {
			return netip.Addr{}, false
		}
		value = values[0]<<24 | values[1]<<16 | values[2]
	case 4:
		for _, v := range values {
			if v > 0xff {
				return netip.Addr{}, false
			}
		}
		value = values[0]<<24 | values[1]<<16 | values[2]<<8 | values[3]
	}
	return netip.AddrFrom4([4]byte{byte(value >> 24), byte(value >> 16), byte(value >> 8), byte(value)}), true
}

func isPrivate(addr netip.Addr) bool {
	addr = addr.Unmap()
	if addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsUnspecified() || addr.IsMulticast() {
		return true
	}
	for _, prefix := range reservedPrefixes {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}
