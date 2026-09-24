package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
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
