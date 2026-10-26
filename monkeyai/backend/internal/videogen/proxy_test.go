package videogen

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVideoProxySendsHostname(t *testing.T) {
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.URL.Host
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	client := (&Service{client: providerClient()}).clientFor(server.URL)
	response, err := client.Get("http://video.invalid/v1/tasks/1")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if received != "video.invalid" {
		t.Fatalf("代理应收到原始域名: %q", received)
	}
	if _, err := client.Get("http://127.0.0.1/v1/tasks/1"); !errors.Is(err, errAddressBlocked) {
		t.Fatalf("内网 IP 应被拦截: %v", err)
	}
}
