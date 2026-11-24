package proxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
)

func TestModelNetworkPolicyAppliesToNewGatewayRequests(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	for _, via := range []bool{false, true} {
		var calls atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			if via && (!r.URL.IsAbs() || r.URL.Hostname() == "localhost") {
				t.Error("未使用所选代理")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"r","usage":{"prompt_tokens":1,"completion_tokens":1}}`))
		}))
		t.Cleanup(server.Close)
		target := testTarget(server.URL)
		if via {
			target.BaseURL = "http://localhost:1234"
			target.ProxyURL = server.URL
			t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8,::1/128")
		}
		var rules []netip.Prefix
		read := func(context.Context) ([]netip.Prefix, error) { return rules, nil }
		billing := estimateBilling{calls: make(chan Call, 1)}
		p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) { return target, nil }), discardLogger()).WithTransport(GatewayTransport(read)).WithBilling(billing)
		for _, deny := range []bool{false, true, false} {
			rules = nil
			if deny {
				rules = []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")}
			}
			r := newProxyRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"test"}`))
			r.Header.Set("Authorization", "Bearer test")
			w := httptest.NewRecorder()
			p.ServeHTTP(w, r)
			p.captures.Wait()
			select {
			case c := <-billing.calls:
				if deny && (w.Code != 403 || c.ErrorCode != "model_address_denied" || !c.Known || c.InputTokens != 0 || c.OutputTokens != 0) {
					t.Fatalf("拒绝结果：%d %+v", w.Code, c)
				}
				if !deny && w.Code != 200 {
					t.Fatalf("允许时状态：%d %s", w.Code, w.Body.String())
				}
			default:
				t.Fatal("缺少结算结果")
			}
		}
		if calls.Load() != 2 {
			t.Fatalf("上游或代理收到 %d 次请求", calls.Load())
		}
	}
}
