package mcp

import (
	"context"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
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
		_ = json.NewEncoder(w).Encode(resource.Object{"id": in.ID, "result": result})
	}))
	defer s.Close()
	tools, err := discover(context.Background(), s.URL, nil)
	if err != nil || len(tools) != 2 || pages != 2 {
		t.Fatalf("未完整发现分页目录: %+v %v", tools, err)
	}
}
