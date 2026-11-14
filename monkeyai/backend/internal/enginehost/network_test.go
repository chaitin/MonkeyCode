package enginehost

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestPublicIP(t *testing.T) {
	for _, test := range []struct{ peer, forwarded, want string }{
		{"8.8.8.8:443", "1.1.1.1", "8.8.8.8"},
		{"172.18.0.2:443", "1.1.1.1", "1.1.1.1"},
		{"172.18.0.2:443", "10.0.0.1", ""},
		{"127.0.0.1:443", "1.1.1.1", ""},
		{"172.18.0.2:443", "bad", ""},
		{"100.64.0.1:443", "", ""},
		{"[2001:4860:4860::8888]:443", "", "2001:4860:4860::8888"},
		{"[::ffff:10.0.0.1]:443", "1.1.1.1", "1.1.1.1"},
	} {
		req := httptest.NewRequest("POST", "/", nil)
		req.RemoteAddr = test.peer
		req.Header.Set("X-Real-IP", test.forwarded)
		if got := publicIP(req); got != test.want {
			t.Errorf("%s: got %q want %q", test.peer, got, test.want)
		}
	}
}
func TestNetworkReport(t *testing.T) {
	req := httptest.NewRequest("POST", "/", nil)
	req.RemoteAddr = "8.8.8.8:443"
	raw := json.RawMessage(`{"system":{"private_ips":["10.0.0.1"],"public_ips":["1.1.1.1"],"future":true},"future":42}`)
	merged := networkReport(raw, req)
	var got struct {
		System *systemReport
		Future int
	}
	if err := json.Unmarshal(merged, &got); err != nil || got.Future != 42 || len(got.System.PublicIPs) != 2 || len(got.System.PrivateIPs) != 1 {
		t.Fatal(string(merged), err)
	}
	if string(networkReport(merged, req)) != string(merged) {
		t.Fatal("重复添加公网地址")
	}
	if string(raw) != `{"system":{"private_ips":["10.0.0.1"],"public_ips":["1.1.1.1"],"future":true},"future":42}` {
		t.Fatal("改写了原始签名输入")
	}
	var fields struct{ System map[string]json.RawMessage }
	if err := json.Unmarshal(merged, &fields); err != nil {
		t.Fatal(err)
	}
	if string(fields.System["future"]) != "true" {
		t.Fatal("丢弃未知字段")
	}
	req.RemoteAddr = "10.0.0.1:443"
	if string(networkReport(raw, req)) != string(raw) {
		t.Fatal("将内网连接误判为公网")
	}
}

func TestNetworkPoliciesAllowLegacyAndKnownCapabilities(t *testing.T) {
	for _, p := range [][]string{nil, {}, {"isolated"}, {"public-only"}, {"isolated", "public-only"}} {
		if !validNetworkPolicies(p) {
			t.Fatal(p)
		}
	}
	for _, p := range [][]string{{"host"}, {"isolated", "isolated"}, {"public-only", "host"}, {"isolated", "public-only", "host"}} {
		if validNetworkPolicies(p) {
			t.Fatal(p)
		}
	}
}
