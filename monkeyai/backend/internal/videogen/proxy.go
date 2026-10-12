package videogen

import (
	"crypto/tls"
	"errors"
	"net"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type videoProxy struct{ address string }

func (p videoProxy) RoundTrip(req *http.Request) (*http.Response, error) {
	name := req.URL.Hostname()
	ips, err := net.DefaultResolver.LookupNetIP(req.Context(), "ip", name)
	if err != nil || len(ips) == 0 {
		return nil, errors.New("上游地址无法解析")
	}
	for _, ip := range ips {
		if !externalIP(ip) {
			return nil, errors.New("上游地址不在公网范围")
		}
	}
	pinned := req.Clone(req.Context())
	address := *req.URL
	port := address.Port()
	if port == "" {
		if address.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	address.Host = net.JoinHostPort(ips[0].Unmap().String(), port)
	pinned.URL = &address
	pinned.Host = req.URL.Host
	transport, err := proxy.TransportFor(p.address)
	if err != nil {
		return nil, err
	}
	transport.TLSClientConfig = &tls.Config{ServerName: name}
	defer transport.CloseIdleConnections()
	return transport.RoundTrip(pinned)
}

func (s *Service) clientFor(address string) *http.Client {
	if address == "" {
		return s.client
	}
	copy := *s.client
	copy.Transport = videoProxy{address: address}
	return &copy
}
