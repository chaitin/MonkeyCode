package netpolicy

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
)

// Transport resolves and validates the final target for each request, including requests sent via a proxy.
type Transport struct {
	Base  *http.Transport
	Check func(context.Context, []netip.Addr) error
}

func Wrap(base *http.Transport, read Reader) http.RoundTripper {
	if read == nil {
		return base
	}
	return Transport{Base: base, Check: read.Check}
}

// Rebase preserves the destination policy when a model selects a system proxy.
func Rebase(original http.RoundTripper, base *http.Transport) http.RoundTripper {
	if guarded, ok := original.(Transport); ok {
		guarded.Base = base
		return guarded
	}
	return base
}

func (t Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	host := req.URL.Hostname()
	ips, err := net.DefaultResolver.LookupNetIP(req.Context(), "ip", host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("无法解析连接目标")
	}
	if err := t.Check(req.Context(), ips); err != nil {
		return nil, err
	}
	tr := t.Base.Clone()
	tr.DisableKeepAlives = true
	defer tr.CloseIdleConnections()
	var via *url.URL
	if tr.Proxy != nil {
		via, err = tr.Proxy(req)
		if err != nil {
			return nil, err
		}
		tr.Proxy = http.ProxyURL(via)
	}
	if via == nil {
		dial := tr.DialContext
		if dial == nil {
			dial = (&net.Dialer{}).DialContext
		}
		tr.DialTLSContext = nil
		tr.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			_, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				var c net.Conn
				c, err = dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
				if err == nil {
					return c, nil
				}
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
			}
			return nil, err
		}
		return tr.RoundTrip(req)
	}
	pinned := req.Clone(req.Context())
	port := req.URL.Port()
	if port == "" {
		port = "80"
		if req.URL.Scheme == "https" {
			port = "443"
		}
	}
	pinned.URL.Host = net.JoinHostPort(ips[0].Unmap().String(), port)
	pinned.Host = req.URL.Host
	// Go uses Request.Host in the absolute URI for a plain HTTP forward proxy.
	// Provide an explicit absolute request URI so routing uses the checked IP while the Host header keeps its original value.
	if req.URL.Scheme == "http" && (via.Scheme == "http" || via.Scheme == "https") {
		path := pinned.URL.EscapedPath()
		if path == "" {
			path = "/"
		}
		pinned.URL.Opaque = "//" + pinned.URL.Host + path
	}
	if tr.TLSClientConfig == nil {
		tr.TLSClientConfig = &tls.Config{}
	}
	if via.Scheme == "https" && tr.DialTLSContext == nil {
		// The proxy and the upstream have separate TLS identities.
		proxyTLS := tr.TLSClientConfig.Clone()
		proxyTLS.ServerName = via.Hostname()
		proxyTLS.NextProtos = []string{"http/1.1"}
		tr.DialTLSContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			if timeout := tr.TLSHandshakeTimeout; timeout > 0 {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, timeout)
				defer cancel()
			}
			return (&tls.Dialer{Config: proxyTLS}).DialContext(ctx, network, address)
		}
	}
	tr.TLSClientConfig.ServerName = host
	return tr.RoundTrip(pinned)
}
