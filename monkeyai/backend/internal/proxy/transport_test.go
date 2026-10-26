package proxy

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPSTransportConnectsToProxy(t *testing.T) {
	var received string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.URL.String()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	transport, err := TransportFor(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer transport.CloseIdleConnections()
	response, err := (&http.Client{Transport: transport}).Get("http://upstream.invalid/v1/models")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if received != "http://upstream.invalid/v1/models" {
		t.Fatalf("HTTPS 代理未收到目标请求: %q", received)
	}
}

func TestHTTPSProxyPreservesUpstreamVerification(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			http.Error(w, "CONNECT required", http.StatusMethodNotAllowed)
			return
		}
		remote, err := net.Dial("tcp", r.Host)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer remote.Close()
		conn, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		if _, err := conn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
			t.Error(err)
			return
		}
		go io.Copy(remote, buffered)
		io.Copy(conn, remote)
	}))
	defer server.Close()

	for _, trusted := range []bool{false, true} {
		name := "untrusted"
		if trusted {
			name = "trusted"
		}
		t.Run(name, func(t *testing.T) {
			transport, err := TransportFor(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer transport.CloseIdleConnections()
			roots := x509.NewCertPool()
			if trusted {
				roots.AddCert(upstream.Certificate())
			}
			transport.TLSClientConfig = &tls.Config{RootCAs: roots}
			response, err := (&http.Client{Transport: transport}).Get(upstream.URL)
			if response != nil {
				response.Body.Close()
			}
			if trusted {
				if err != nil {
					t.Fatalf("通过自签 HTTPS 代理访问可信上游失败: %v", err)
				}
				if response.StatusCode != http.StatusNoContent {
					t.Fatalf("上游响应状态错误: %d", response.StatusCode)
				}
			} else {
				var certificateError x509.UnknownAuthorityError
				if !errors.As(err, &certificateError) {
					t.Fatalf("未拒绝不可信上游证书: %v", err)
				}
			}
		})
	}
}

func TestOutboundTransportUsesSelectedProxy(t *testing.T) {
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.URL.String()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	transport := outboundTransport{direct: DirectTransport()}
	req, err := http.NewRequest(http.MethodGet, "http://upstream.invalid/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), proxyContextKey{}, &proxyContext{target: Target{ProxyURL: server.URL}}))
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent || !strings.Contains(received, "upstream.invalid/v1/models") {
		t.Fatalf("代理未收到请求: %d %q", resp.StatusCode, received)
	}
	for _, address := range []string{"https://proxy.example:443", "socks5://proxy.example:1080"} {
		client, err := TransportFor(address)
		if err != nil {
			t.Fatal(err)
		}
		got, err := client.Proxy(req)
		if err != nil || got.String() != address {
			t.Fatalf("代理协议错误: %v %v", got, err)
		}
	}
}

func TestTransportReportsConnectRejection(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{{http.StatusProxyAuthRequired, "proxy_auth_required"}, {http.StatusForbidden, "proxy_connect_rejected"}} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
		}))
		transport, err := TransportFor(server.URL)
		if err != nil {
			t.Fatal(err)
		}
		_, err = (&http.Client{Transport: transport}).Get("https://upstream.invalid/v1/models")
		transport.CloseIdleConnections()
		server.Close()
		connect, ok := errors.AsType[*ConnectError](err)
		if !ok || connect.Status != tc.status || connect.DiagnosticCode() != tc.code {
			t.Fatalf("CONNECT 拒绝分类错误: %v", err)
		}
	}
}
