package videogen

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/netpolicy"

	"context"
	"net/http"
	"net/netip"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type videoProxy struct {
	address string
	network netpolicy.Reader
}

// With a network policy, resolve and validate the final target before contacting the proxy.
func (p videoProxy) RoundTrip(req *http.Request) (*http.Response, error) {
	if ip, err := netip.ParseAddr(req.URL.Hostname()); err == nil && !externalIP(ip) {
		return nil, errAddressBlocked
	}
	transport, err := proxy.TransportFor(p.address)
	if err != nil {
		return nil, err
	}
	defer transport.CloseIdleConnections()
	return videoTransport(transport, p.network).RoundTrip(req)
}

func videoTransport(base *http.Transport, read netpolicy.Reader) http.RoundTripper {
	if read == nil {
		return base
	}
	return netpolicy.Transport{Base: base, Check: func(ctx context.Context, ips []netip.Addr) error {
		if err := read.Check(ctx, ips); err != nil {
			return err
		}
		for _, ip := range ips {
			if !externalIP(ip) {
				return errAddressBlocked
			}
		}
		return nil
	}}
}

func (s *Service) clientFor(address string) *http.Client {
	copy := *s.client
	if address == "" {
		if s.network == nil {
			return s.client
		}
		copy.Transport = videoTransport(proxy.DirectTransport(), s.network)
	} else {
		copy.Transport = videoProxy{address: address, network: s.network}
	}
	return &copy
}
