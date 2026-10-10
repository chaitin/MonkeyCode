package mcp

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

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
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
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

func TestToolCallIgnoresEnvironmentProxy(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var call struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		if err := json.NewDecoder(r.Body).Decode(&call); err != nil {
			t.Error(err)
			return
		}
		if call.Method == "notifications/initialized" {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		result := resource.Object{"ok": true}
		if call.Method == "initialize" {
			result = resource.Object{"protocolVersion": "2025-03-26"}
		}
		resource.JSON(w, http.StatusOK, resource.Object{"jsonrpc": "2.0", "id": call.ID, "result": result})
	}))
	defer server.Close()
	rpc, err := openRemote(t.Context(), server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer rpc.close()
	result, err := rpc.call(t.Context(), 2, "tools/call", resource.Object{"name": "test"})
	if err != nil || !strings.Contains(string(result), `"ok":true`) {
		t.Fatalf("工具调用未直连: %s %v", result, err)
	}
}

func TestClientDirectTransport(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	t.Setenv("NO_PROXY", "example.invalid")
	transport, ok := client().Transport.(*http.Transport)
	if !ok || transport.Proxy != nil {
		t.Fatal("MCP transport 不应设置代理回调")
	}

	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer s.Close()
	c := client()
	defer c.CloseIdleConnections()
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
	if _, err := c.Get(s.URL); err == nil || !strings.Contains(err.Error(), "目标地址不在允许范围内") {
		t.Fatalf("直连地址限制失效: %v", err)
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	resp, err := c.Get(s.URL)
	if err != nil {
		t.Fatalf("白名单内直连失败: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("直连返回状态错误: %d", resp.StatusCode)
	}
	if _, err := c.Get(s.URL + "/redirect"); err == nil || !strings.Contains(err.Error(), "不允许自动重定向") {
		t.Fatalf("重定向未拦截: %v", err)
	}
}

func TestTokenProxyPinsConnectIPAndKeepsTLSIdentity(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	var host, serverName string
	token := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, serverName = r.Host, r.TLS.ServerName
		w.WriteHeader(http.StatusNoContent)
	}))
	defer token.Close()
	proxyTarget := make(chan string, 2)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			t.Errorf("代理收到非 CONNECT 请求: %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		proxyTarget <- r.Host
		upstream, err := net.Dial("tcp", r.Host)
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			upstream.Close()
			t.Error(err)
			return
		}
		defer conn.Close()
		defer upstream.Close()
		if _, err := io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
			t.Error(err)
			return
		}
		go func() { _, _ = io.Copy(upstream, conn); _ = upstream.Close() }()
		_, _ = io.Copy(conn, upstream)
	}))
	defer proxy.Close()
	p, _ := url.Parse(proxy.URL)
	proxyForToken := func(*http.Request) (*url.URL, error) { return p, nil }
	resolve := func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}
	address, _ := url.Parse(token.URL)
	address.Host = net.JoinHostPort("example.com", address.Port())
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, address.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	h, target, err := tokenClient(req, proxyForToken, resolve)
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	roots := x509.NewCertPool()
	roots.AddCert(token.Certificate())
	h.Transport.(*http.Transport).TLSClientConfig.RootCAs = roots
	resp, err := h.Do(target)
	if err != nil {
		t.Fatalf("可信证书的代理请求失败: %v", err)
	}
	resp.Body.Close()
	select {
	case connect := <-proxyTarget:
		if resp.StatusCode != http.StatusNoContent || host != address.Host || serverName != "example.com" || connect != net.JoinHostPort("127.0.0.1", address.Port()) {
			t.Fatalf("代理 CONNECT、HTTP Host 或 TLS SNI 不正确: connect=%q status=%d host=%q sni=%q", connect, resp.StatusCode, host, serverName)
		}
	case <-time.After(time.Second):
		t.Fatal("Token 请求未通过代理 CONNECT")
	}

	address.Host = net.JoinHostPort("untrusted.example", address.Port())
	req, _ = http.NewRequestWithContext(t.Context(), http.MethodPost, address.String(), nil)
	h, target, err = tokenClient(req, proxyForToken, resolve)
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	h.Transport.(*http.Transport).TLSClientConfig.RootCAs = roots
	if resp, err := h.Do(target); err == nil {
		resp.Body.Close()
		t.Fatal("代理模式放宽了 TLS 证书主机名校验")
	}
}

func TestTokenProxyRejectsUnsafeTargets(t *testing.T) {
	p, _ := url.Parse("http://127.0.0.1:3128")
	proxy := func(*http.Request) (*url.URL, error) { return p, nil }
	for _, tc := range []struct {
		name, target string
		ips          []netip.Addr
	}{
		{"仅内网", "https://example.com/token", []netip.Addr{netip.MustParseAddr("10.0.0.1")}},
		{"混合解析", "https://example.com/token", []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("127.0.0.1")}},
		{"带区域标识", "https://example.com/token", []netip.Addr{netip.MustParseAddr("2001:4860:4860::8888%lo0")}},
		{"HTTP 目标", "http://example.com/token", []netip.Addr{netip.MustParseAddr("8.8.8.8")}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
			req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, tc.target, nil)
			_, _, err := tokenClient(req, proxy, func(context.Context, string, string) ([]netip.Addr, error) { return tc.ips, nil })
			if err == nil {
				t.Fatal("不安全的目标地址通过了代理校验")
			}
		})
	}
	secureProxy, _ := url.Parse("https://127.0.0.1:3128")
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, "https://example.com/token", nil)
	if _, _, err := tokenClient(req, func(*http.Request) (*url.URL, error) { return secureProxy, nil }, nil); err == nil {
		t.Fatal("不支持的 HTTPS 代理未被拒绝")
	}
}

func TestTokenEnvironmentNoProxy(t *testing.T) {
	if os.Getenv("MCP_PROXY_TEST_CHILD") == "1" {
		req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, "https://example.com/token", nil)
		h, direct, err := tokenClient(req, http.ProxyFromEnvironment, func(context.Context, string, string) ([]netip.Addr, error) {
			t.Fatal("NO_PROXY 命中时不应走代理域名解析")
			return nil, nil
		})
		if err != nil || h.Transport.(*http.Transport).Proxy != nil || direct.URL.Host != req.URL.Host {
			t.Fatalf("NO_PROXY 未保持直连策略: %v", err)
		}
		req, _ = http.NewRequestWithContext(t.Context(), http.MethodPost, "https://other.example/token", nil)
		_, _, err = tokenClient(req, http.ProxyFromEnvironment, func(context.Context, string, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		})
		if err == nil || !strings.Contains(err.Error(), "目标地址不在允许范围内") {
			t.Fatalf("环境代理未对非 NO_PROXY 域名执行目标 IP 校验: %v", err)
		}
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestTokenEnvironmentNoProxy$")
	cmd.Env = append(os.Environ(), "MCP_PROXY_TEST_CHILD=1", "HTTPS_PROXY=http://127.0.0.1:3128", "NO_PROXY=example.com")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("子进程代理环境测试失败: %v\n%s", err, output)
	}
}
