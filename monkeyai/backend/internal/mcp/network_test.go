package mcp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type networkTestSettings struct {
	blocked []netip.Prefix
	err     error
}

func (s *networkTestSettings) MCPBlockedCIDRs(context.Context) ([]netip.Prefix, error) {
	return s.blocked, s.err
}

type networkTestProxy string

func (p networkTestProxy) ProxyURL(context.Context, string) (string, error) {
	return string(p), nil
}

func TestMCPBlacklistOverridesAllowlist(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "10.0.0.0/8,fc00::/7,127.0.0.0/8")
	settings := &networkTestSettings{blocked: []netip.Prefix{
		netip.MustParsePrefix("10.1.0.0/16"),
		netip.MustParsePrefix("fd00::/8"),
		netip.MustParsePrefix("8.8.8.8/32"),
		netip.MustParsePrefix("127.0.0.1/32"),
	}}
	for _, tc := range []struct {
		addr string
		deny bool
	}{
		{"10.1.0.0", true}, {"10.1.255.255", true}, {"::ffff:10.1.2.3", true},
		{"fd00::1", true}, {"8.8.8.8", true}, {"127.0.0.1", true},
		{"10.2.0.1", false}, {"fc00::1", false}, {"1.1.1.1", false},
		{"169.254.169.254", true},
	} {
		t.Run(tc.addr, func(t *testing.T) {
			err := checkIPs(t.Context(), []netip.Addr{netip.MustParseAddr(tc.addr)}, settings)
			if (err != nil) != tc.deny {
				t.Fatalf("地址 %s 黑名单校验错误: %v", tc.addr, err)
			}
		})
	}
	readErr := errors.New("数据库不可用")
	settings.err = readErr
	if err := checkIPs(t.Context(), []netip.Addr{netip.MustParseAddr("1.1.1.1")}, settings); !errors.Is(err, readErr) {
		t.Fatalf("读取黑名单失败时不得继续连接: %v", err)
	}
}

func TestMCPDirectBlacklistChangesApplyToExistingClient(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	var called atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	settings := &networkTestSettings{}
	s := NewService(nil, "").WithNetworkSettings(settings)
	h, err := s.clientFor(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	for _, deny := range []bool{false, true, false} {
		settings.blocked = nil
		if deny {
			settings.blocked = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
		}
		resp, err := h.Get(server.URL)
		if resp != nil {
			resp.Body.Close()
		}
		if deny {
			if err == nil || upstreamFailure(err, "").Code != "mcp_address_denied" {
				t.Fatalf("已有客户端绕过更新后的黑名单: %v", err)
			}
		} else if err != nil {
			t.Fatal(err)
		}
	}
	if called.Load() != 2 {
		t.Fatalf("黑名单请求不应到达上游: %d", called.Load())
	}
}

func TestMCPConfiguredProxyEnforcesBlacklist(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
	var called atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called.Add(1)
		resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"access_token": "token"})
	}))
	defer proxy.Close()
	settings := &networkTestSettings{blocked: []netip.Prefix{netip.MustParsePrefix("8.8.8.8/32")}}
	s := NewService(nil, "").WithNetworkSettings(settings).WithProxyResolver(networkTestProxy(proxy.URL))
	h, err := s.clientFor(t.Context(), resource.Object{"proxy_id": "proxy"})
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	if resp, err := h.Get("http://8.8.8.8/mcp"); err == nil {
		resp.Body.Close()
		t.Fatal("系统代理绕过了黑名单")
	}
	config := resource.Object{
		"proxy_id":     "proxy",
		"oauth_config": oauthConfig{ClientID: "client", TokenURL: "http://8.8.8.8/token"},
	}
	if _, err := s.exchange(t.Context(), config, url.Values{"grant_type": {"refresh_token"}}); err == nil || upstreamFailure(err, "").Code != "mcp_address_denied" {
		t.Fatalf("OAuth 系统代理绕过了黑名单: %v", err)
	}
	if called.Load() != 0 {
		t.Fatal("被拒绝的请求不应发送给代理")
	}
	settings.blocked = nil
	result, err := s.exchange(t.Context(), config, url.Values{"grant_type": {"refresh_token"}})
	if err != nil || result.Access != "token" || called.Load() != 1 {
		t.Fatalf("移除黑名单后应恢复代理请求: %+v %v", result, err)
	}
}

func TestMCPTokenProxyRejectsBlacklistedDNSAnswers(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
	p, _ := url.Parse("http://127.0.0.1:3128")
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodPost, "https://example.com/token", nil)
	settings := &networkTestSettings{blocked: []netip.Prefix{netip.MustParsePrefix("10.1.0.0/16")}}
	proxy := func(*http.Request) (*url.URL, error) { return p, nil }
	lookup := func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("::ffff:10.1.2.3")}, nil
	}
	if _, _, err := tokenClient(req, proxy, lookup, settings); err == nil || upstreamFailure(err, "").Code != "mcp_address_denied" {
		t.Fatalf("任一 DNS 结果命中黑名单时应拒绝 OAuth 环境代理: %v", err)
	}
	settings.blocked = nil
	h, target, err := tokenClient(req, proxy, lookup, settings)
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	if target.URL.Host != "8.8.8.8:443" || target.Host != "example.com" {
		t.Fatal("移除黑名单后应继续固定代理目标 IP")
	}
}
