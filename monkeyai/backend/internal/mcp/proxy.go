package mcp

import (
	"context"
	"crypto/tls"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/netpolicy"
	"net/http"
	"net/netip"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type checkedProxy struct {
	address       string
	network       NetworkSettings
	skipTLSVerify bool
}

func (p checkedProxy) RoundTrip(req *http.Request) (*http.Response, error) {
	transport, err := proxy.TransportFor(p.address)
	if err != nil {
		return nil, err
	}
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: p.skipTLSVerify}
	return (netpolicy.Transport{Base: transport, Check: func(ctx context.Context, ips []netip.Addr) error { return checkIPs(ctx, ips, p.network) }}).RoundTrip(req)
}

func setSkipTLSVerify(h *http.Client, skip bool) {
	// 每次请求使用独立的 transport，仅在连接器显式启用时跳过证书校验。
	switch transport := h.Transport.(type) {
	case *http.Transport:
		if transport.TLSClientConfig == nil {
			transport.TLSClientConfig = &tls.Config{}
		}
		transport.TLSClientConfig.InsecureSkipVerify = skip
	case checkedProxy:
		transport.skipTLSVerify = skip
		h.Transport = transport
	}
}

func (s *Service) clientFor(ctx context.Context, c resource.Object) (*http.Client, error) {
	h := client(s.network)
	id := c.String("proxy_id")
	if id == "" {
		setSkipTLSVerify(h, c.Bool("skip_tls_verify"))
		return h, nil
	}
	if s.proxies == nil {
		return nil, fmt.Errorf("系统代理不可用")
	}
	address, err := s.proxies.ProxyURL(ctx, id)
	if err != nil {
		return nil, err
	}
	h.Transport = checkedProxy{address: address, network: s.network}
	setSkipTLSVerify(h, c.Bool("skip_tls_verify"))
	return h, nil
}
