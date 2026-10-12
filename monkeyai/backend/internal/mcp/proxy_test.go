package mcp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConfiguredProxyCannotReachPrivateTarget(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	defer server.Close()
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:9988/mcp", nil)
	if _, err := (checkedProxy{address: server.URL}).RoundTrip(req); err == nil || called {
		t.Fatalf("系统代理不得绕过连接器私网限制: %v, called=%v", err, called)
	}
}
