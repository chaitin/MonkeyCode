package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
)

type outboundTransport struct{ direct http.RoundTripper }

func TransportFor(raw string) (*http.Transport, error) {
	address, err := url.Parse(raw)
	if err != nil || address.Host == "" {
		return nil, fmt.Errorf("系统代理配置无效")
	}
	transport := DirectTransport()
	transport.Proxy = http.ProxyURL(address)
	if address.Scheme == "https" {
		transport.DialTLSContext = func(ctx context.Context, network, target string) (net.Conn, error) {
			config := &tls.Config{}
			if transport.TLSClientConfig != nil {
				config = transport.TLSClientConfig.Clone()
			}
			config.ServerName = address.Hostname()
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
