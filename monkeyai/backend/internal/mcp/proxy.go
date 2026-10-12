package mcp

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type checkedProxy struct{ address string }

func (p checkedProxy) RoundTrip(req *http.Request) (*http.Response, error) {
	name := req.URL.Hostname()
	ips, err := net.DefaultResolver.LookupNetIP(req.Context(), "ip", name)
	if err != nil || len(ips) == 0 {
		return nil, fmt.Errorf("无法解析连接目标")
	}
	for _, ip := range ips {
		if ip.Zone() != "" || !allowedIP(ip) {
			return nil, fmt.Errorf("目标地址不在允许范围内")
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

func (s *Service) clientFor(ctx context.Context, id string) (*http.Client, error) {
	if id == "" {
		return client(), nil
	}
	if s.proxies == nil {
		return nil, fmt.Errorf("系统代理不可用")
	}
	address, err := s.proxies.ProxyURL(ctx, id)
	if err != nil {
		return nil, err
	}
	h := client()
	h.Transport = checkedProxy{address: address}
	return h, nil
}
