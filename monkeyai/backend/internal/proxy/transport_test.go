package proxy

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
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
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	transport.TLSClientConfig = &tls.Config{RootCAs: roots}
	response, err := (&http.Client{Transport: transport}).Get("http://upstream.invalid/v1/models")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if received != "http://upstream.invalid/v1/models" {
		t.Fatalf("HTTPS 代理未收到目标请求: %q", received)
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
