package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestOutboundPolicy(t *testing.T) {
	for _, addr := range []string{"127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"} {
		if allowedIP(netip.MustParseAddr(addr)) {
			t.Fatalf("默认放行私网地址 %s", addr)
		}
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "10.1.0.0/16")
	if !allowedIP(netip.MustParseAddr("10.1.2.3")) || allowedIP(netip.MustParseAddr("10.2.2.3")) {
		t.Fatal("CIDR 白名单无效")
	}
}
func TestDiscoveryPagination(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	pages := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID     int               `json:"id"`
			Method string            `json:"method"`
			Params map[string]string `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		w.Header().Set("Content-Type", "application/json")
		var result resource.Object
		switch in.Method {
		case "initialize":
			result = resource.Object{"protocolVersion": "2025-03-26"}
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			pages++
			name := "one"
			result = resource.Object{"nextCursor": "second"}
			if in.Params["cursor"] == "second" {
				name = "two"
				delete(result, "nextCursor")
			}
			result["tools"] = []resource.Object{{"name": name, "inputSchema": resource.Object{"type": "object"}}}
		}
		_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}))
	defer s.Close()
	tools, err := discover(context.Background(), s.URL, nil)
	if err != nil || len(tools) != 2 || pages != 2 {
		t.Fatalf("未完整发现分页目录: %+v %v", tools, err)
	}
}

func TestHTTPProxyPolicy(t *testing.T) {
	if os.Getenv("MCP_PROXY_TEST_CHILD") == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestHTTPProxyPolicy$")
		cmd.Env = append(os.Environ(), "MCP_PROXY_TEST_CHILD=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("代理策略子进程失败: %v\n%s", err, out)
		}
		return
	}

	var requests []string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.RequestURI)
		if r.Method == http.MethodConnect {
			w.WriteHeader(http.StatusBadGateway)
		} else if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
		} else {
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer proxy.Close()
	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("http_proxy", "")
	t.Setenv("https_proxy", "")
	t.Setenv("NO_PROXY", "127.0.0.1,localhost,198.18.0.1")
	t.Setenv("no_proxy", "")

	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer direct.Close()
	request := func(target string) (*http.Response, error) {
		c := client()
		defer c.CloseIdleConnections()
		return c.Get(target)
	}

	if _, err := request(direct.URL); err == nil || !strings.Contains(err.Error(), "目标地址不在允许范围内") {
		t.Fatalf("直连私网未拦截: %v", err)
	}
	if len(requests) != 0 {
		t.Fatalf("NO_PROXY 直连却访问了代理: %v", requests)
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	resp, err := request(direct.URL)
	if err != nil || resp.StatusCode != http.StatusNoContent {
		t.Fatalf("NO_PROXY 直连失败: %v, %v", resp, err)
	}
	resp.Body.Close()
	if _, err = request("http://198.18.0.1/"); err == nil || !strings.Contains(err.Error(), "目标地址不在允许范围内") {
		t.Fatalf("NO_PROXY 目标未受直连限制: %v", err)
	}
	if len(requests) != 0 {
		t.Fatalf("直连请求意外访问代理: %v", requests)
	}

	resp, err = request("http://1.1.1.1/mcp")
	if err != nil || resp.StatusCode != http.StatusOK || len(requests) != 1 || requests[0] != "GET http://1.1.1.1/mcp" {
		t.Fatalf("HTTP 代理未使用本地代理: %v, %v, %v", resp, err, requests)
	}
	resp.Body.Close()
	for _, target := range []string{"http://10.1.2.3/", "https://169.254.169.254/", "http://example.com/", "https://example.com/", "http://[2001:4860:4860::8888%25lo0]/"} {
		if _, err = request(target); err == nil {
			t.Fatalf("代理目标未拦截: %s", target)
		}
	}
	if len(requests) != 1 {
		t.Fatalf("被拒绝的请求访问了代理: %v", requests)
	}

	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8,10.1.0.0/16")
	resp, err = request("http://10.1.2.3/")
	if err != nil || resp.StatusCode != http.StatusOK || len(requests) != 2 || requests[1] != "GET http://10.1.2.3/" {
		t.Fatalf("代理目标白名单无效: %v, %v, %v", resp, err, requests)
	}
	resp.Body.Close()
	if _, err = request("https://1.1.1.1/"); err == nil || len(requests) != 3 || requests[2] != "CONNECT 1.1.1.1:443" {
		t.Fatalf("HTTPS CONNECT 未按目标 IP 发起: %v, %v", err, requests)
	}
	if _, err = request("http://1.1.1.1/redirect"); err == nil || !strings.Contains(err.Error(), "不允许自动重定向") || len(requests) != 4 {
		t.Fatalf("代理重定向未拦截: %v, %v", err, requests)
	}
}
