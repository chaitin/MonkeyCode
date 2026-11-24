package setting

import (
	"encoding/json"
	"errors"
	"net/netip"
	"testing"
)

func TestModelNetworkSettingsAreIndependent(t *testing.T) {
	ctx := t.Context()
	store := &memoryStore{records: map[string]Record{}}
	s := NewService(store)
	read := func(key string) []netip.Prefix {
		t.Helper()
		ips, err := s.blockedCIDRs(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		return ips
	}
	if len(read("model_network")) != 0 {
		t.Fatal("未配置时应为空")
	}
	for key, data := range map[string]string{"mcp": `{"blocked_cidrs":["10.0.0.0/8"]}`, "model_network": `{"blocked_cidrs":["::ffff:192.0.2.8/120"]}`} {
		if _, err := s.Put(ctx, key, json.RawMessage(data), 1, "admin"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Put(ctx, "model_network", json.RawMessage(`{"blocked_cidrs":["invalid"]}`), 1, "admin"); err == nil {
		t.Fatal("无效设置应被拒绝")
	}
	if x := read("model_network"); len(x) != 1 || x[0].String() != "192.0.2.0/24" {
		t.Fatal(x)
	}
	cfg, err := s.AgentConfig(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := cfg.Settings["model_network"]; ok {
		t.Fatal("不应下发模型网络配置")
	}
	if _, err := s.Put(ctx, "model_network", json.RawMessage(`{"blocked_cidrs":[]}`), 1, "admin"); err != nil {
		t.Fatal(err)
	}
	if x := read("mcp"); len(x) != 1 || x[0].String() != "10.0.0.0/8" {
		t.Fatal(x)
	}
	store.err = errors.New("读取失败")
	if _, err := s.ModelBlockedCIDRs(ctx); !errors.Is(err, store.err) {
		t.Fatal(err)
	}
}
