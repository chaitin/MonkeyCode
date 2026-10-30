package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"time"
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
			conn, err := (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext(ctx, network, target)
			if err != nil {
				return nil, err
			}
			tlsConn := tls.Client(conn, config)
			handshakeCtx := ctx
			if transport.TLSHandshakeTimeout > 0 {
				var cancel context.CancelFunc
				handshakeCtx, cancel = context.WithTimeout(ctx, transport.TLSHandshakeTimeout)
				defer cancel()
			}
			if err := tlsConn.HandshakeContext(handshakeCtx); err != nil {
				conn.Close()
				return nil, err
			}
			return tlsConn, nil
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
	transport.DisableKeepAlives = true
	transport.ResponseHeaderTimeout = upstreamHeaderTimeout
	defer transport.CloseIdleConnections()
	return transport.RoundTrip(req)
}
