package netguard

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"testing"
)

type staticResolver map[string][]net.IP

func (r staticResolver) LookupIP(_ context.Context, _ string, host string) ([]net.IP, error) {
	ips, ok := r[host]
	if !ok {
		return nil, errors.New("not found")
	}
	return ips, nil
}

func TestValidateURLBlocksPrivateNetwork(t *testing.T) {
	guard := New(true)
	guard.resolver = staticResolver{
		"public.example":  {net.ParseIP("8.8.8.8")},
		"private.example": {net.ParseIP("10.0.0.1")},
	}

	allowed := []string{"https://public.example/v1", "http://8.8.8.8"}
	for _, rawURL := range allowed {
		if err := guard.ValidateURL(context.Background(), rawURL); err != nil {
			t.Fatalf("ValidateURL(%q) error = %v", rawURL, err)
		}
	}

	blocked := []string{
		"http://localhost",
		"http://127.0.0.1",
		"http://2130706433",
		"http://0177.0.0.1",
		"http://0x7f000001",
		"http://[::1]",
		"http://[::ffff:127.0.0.1]",
		"http://169.254.169.254/latest/meta-data",
		"https://private.example/v1",
	}
	for _, rawURL := range blocked {
		if err := guard.ValidateURL(context.Background(), rawURL); !errors.Is(err, ErrPrivateNetwork) {
			t.Fatalf("ValidateURL(%q) error = %v, want ErrPrivateNetwork", rawURL, err)
		}
	}
}

func TestValidateURLAllowsPrivateNetworkWhenDisabled(t *testing.T) {
	guard := New(false)
	if err := guard.ValidateURL(context.Background(), "http://127.0.0.1:8080"); err != nil {
		t.Fatalf("ValidateURL() error = %v", err)
	}
}

func TestValidateURLRejectsUnsupportedScheme(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		if err := New(enabled).ValidateURL(context.Background(), "file:///etc/passwd"); err == nil {
			t.Fatalf("ValidateURL() error = nil, enabled = %v", enabled)
		}
	}
}

func TestHTTPClientBlocksPrivateProxy(t *testing.T) {
	proxyURL, err := url.Parse("http://127.0.0.1:8080")
	if err != nil {
		t.Fatal(err)
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(proxyURL)
	client := New(true).HTTPClient(&http.Client{Transport: transport})
	req, err := http.NewRequest(http.MethodGet, "http://8.8.8.8", nil)
	if err != nil {
		t.Fatal(err)
	}

	_, err = client.Do(req)
	if !errors.Is(err, ErrPrivateNetwork) {
		t.Fatalf("Do() error = %v, want ErrPrivateNetwork", err)
	}
}

func TestHTTPClientPreservesAutomaticHTTP2(t *testing.T) {
	client := New(true).HTTPClient(&http.Client{Transport: &http.Transport{}})
	transport, ok := client.Transport.(*guardedTransport)
	if !ok {
		t.Fatalf("Transport type = %T, want *guardedTransport", client.Transport)
	}
	if !transport.direct.ForceAttemptHTTP2 {
		t.Fatal("direct transport ForceAttemptHTTP2 = false")
	}
	if !transport.proxied.ForceAttemptHTTP2 {
		t.Fatal("proxied transport ForceAttemptHTTP2 = false")
	}
}

func TestHTTPClientPreservesDisabledHTTP2(t *testing.T) {
	client := New(true).HTTPClient(&http.Client{Transport: &http.Transport{
		DialContext: (&net.Dialer{}).DialContext,
	}})
	transport, ok := client.Transport.(*guardedTransport)
	if !ok {
		t.Fatalf("Transport type = %T, want *guardedTransport", client.Transport)
	}
	if transport.direct.ForceAttemptHTTP2 {
		t.Fatal("direct transport ForceAttemptHTTP2 = true")
	}
	if transport.proxied.ForceAttemptHTTP2 {
		t.Fatal("proxied transport ForceAttemptHTTP2 = true")
	}
}
