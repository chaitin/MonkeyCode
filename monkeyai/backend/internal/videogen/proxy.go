package videogen

import (
	"net/http"
	"net/netip"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type videoProxy struct{ address string }

// RoundTrip hands the hostname to the proxy so it can resolve and route by
// domain; local DNS may be polluted and differs from the proxy's view.
func (p videoProxy) RoundTrip(req *http.Request) (*http.Response, error) {
	if ip, err := netip.ParseAddr(req.URL.Hostname()); err == nil && !externalIP(ip) {
		return nil, errAddressBlocked
	}
	transport, err := proxy.TransportFor(p.address)
	if err != nil {
		return nil, err
	}
	defer transport.CloseIdleConnections()
	return transport.RoundTrip(req)
}

func (s *Service) clientFor(address string) *http.Client {
	if address == "" {
		return s.client
	}
	copy := *s.client
	copy.Transport = videoProxy{address: address}
	return &copy
}
