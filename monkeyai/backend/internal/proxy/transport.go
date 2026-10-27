package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
)

type outboundTransport struct{ direct http.RoundTripper }

// ConnectError reports a non-200 CONNECT response from the system proxy.
type ConnectError struct{ Status int }

func (e *ConnectError) Error() string { return fmt.Sprintf("系统代理拒绝连接: %d", e.Status) }

func (e *ConnectError) DiagnosticCode() string {
	if e.Status == http.StatusProxyAuthRequired {
		return "proxy_auth_required"
	}
	return "proxy_connect_rejected"
}

func TransportFor(raw string) (*http.Transport, error) {
	address, err := url.Parse(raw)
	if err != nil || address.Host == "" {
		if err != nil {
			slog.Warn("操作失败", "module", "proxy", "operation", "TransportFor", "error", err)
		}
		return nil, fmt.Errorf("系统代理配置无效")
	}
	transport := DirectTransport()
	transport.Proxy = http.ProxyURL(address)
	transport.OnProxyConnectResponse = func(_ context.Context, _ *url.URL, _ *http.Request, response *http.Response) error {
		if response.StatusCode != http.StatusOK {
			return &ConnectError{Status: response.StatusCode}
		}
		return nil
	}
	if address.Scheme == "https" {
		transport.DialTLSContext = func(ctx context.Context, network, target string) (net.Conn, error) {
			config := &tls.Config{}
			if transport.TLSClientConfig != nil {
				config = transport.TLSClientConfig.Clone()
			}
			config.ServerName = address.Hostname()
			// 仅跳过 HTTPS 代理的证书校验，目标服务仍使用原有 TLS 配置。
			config.InsecureSkipVerify = true
			return (&tls.Dialer{Config: config}).DialContext(ctx, network, target)
		}
	}
	return transport, nil
}

func (t outboundTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	context, _ := req.Context().Value(proxyContextKey{}).(*proxyContext)
	if context == nil || context.target.ProxyURL == "" {
		return t.direct.RoundTrip(req)
	}
	transport, err := TransportFor(context.target.ProxyURL)
	if err != nil {
		return nil, err
	}
	defer transport.CloseIdleConnections()
	return transport.RoundTrip(req)
}
