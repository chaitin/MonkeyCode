package control

import (
	"crypto/ed25519"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHostProxyAndDirectExceptions(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, r.URL.String())
	}))
	defer proxy.Close()
	cfg := Config{Server: "http://control.example", ServerURL: "http://private.example", NetworkConfig: NetworkConfig{Proxy: proxy.URL, NoProxy: "10.2.98.0/24,.direct.example"}}
	key := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	client, err := cfg.Client(key)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.HTTP.Get(client.URL + "/api/host/v1/time")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "http://private.example/api/host/v1/time" || client.Server != cfg.Server {
		t.Fatalf("请求未按预期代理或签名地址被更改: %s, %v", body, err)
	}
	for _, address := range []string{"http://10.2.98.116", "https://service.direct.example", "http://127.0.0.1"} {
		r, _ := http.NewRequest("GET", address, nil)
		if u, err := client.HTTP.Transport.(*http.Transport).Proxy(r); u != nil || err != nil {
			t.Fatalf("未直连 %s: %v, %v", address, u, err)
		}
	}
}

func TestNetworkConfigRejectsUnsafeSettings(t *testing.T) {
	for _, raw := range []string{
		`{"proxy":"http://user:secret@proxy.example"}`,
		`{"proxy":"socks5://proxy.example"}`,
		`{"proxy":"http://proxy.example:0"}`,
		`{"no_proxy":"10.2.98.116"}`,
		`{"allow_private_cidrs":["0.0.0.0/0"]}`,
		`{"allow_private_cidrs":["169.254.169.254/32"]}`,
		`{"allow_private_cidrs":["10.2.98.116/24"]}`,
	} {
		var c NetworkConfig
		if err := json.Unmarshal([]byte(raw), &c); err == nil && c.Validate() == nil {
			t.Fatalf("接受无效配置：%s", raw)
		}
	}
}
