package mcp

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type checkedProxy struct {
	address       string
	skipTLSVerify bool
}

func (p checkedProxy) RoundTrip(req *http.Request) (*http.Response, error) {
	name := req.URL.Hostname()
	ips, err := net.DefaultResolver.LookupNetIP(req.Context(), "ip", name)
	if err != nil || len(ips) == 0 {
		if err != nil {
			slog.WarnContext(req.Context(), "操作失败", "module", "mcp", "operation", "RoundTrip", "error", err)
		}
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
	transport.TLSClientConfig = &tls.Config{ServerName: name, InsecureSkipVerify: p.skipTLSVerify}
	defer transport.CloseIdleConnections()
	return transport.RoundTrip(pinned)
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
	h := client()
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
	h.Transport = checkedProxy{address: address}
	setSkipTLSVerify(h, c.Bool("skip_tls_verify"))
	return h, nil
}
