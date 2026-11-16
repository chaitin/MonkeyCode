package vmnet

import (
	"net/netip"
	"strings"
	"testing"
)

func TestIsolatedNetworkDoesNotGainPublicOrCenterAccess(t *testing.T) {
	manager := networkFixture(t)
	manager.config.Policy = "isolated"
	manager.config.Exceptions = []Exception{{IP: netip.MustParseAddr("10.1.2.3"), Port: 8888}}
	rules := manager.rules(record{ID: strings.Repeat("a", 64), Slot: 1})
	if strings.Contains(rules, "udp dport 53 accept") || strings.Contains(rules, "tcp dport { 22, 80, 443 }") || strings.Contains(rules, "tcp dport 8888 accept") {
		t.Fatal("隔离环境获准外部网络", rules)
	}
}
func TestCenterExceptionAllowsOnlyDeclaredEndpointOnHostInput(t *testing.T) {
	manager := networkFixture(t)
	manager.config.Exceptions = []Exception{{IP: netip.MustParseAddr("10.1.2.3"), Port: 8888}}
	rules := manager.rules(record{ID: strings.Repeat("a", 64), Slot: 1})
	if !strings.Contains(rules, `ip saddr 172.30.0.6 ip daddr 10.1.2.3 tcp dport 8888 accept;`) {
		t.Fatal("本机中心服务例外不可达", rules)
	}
	if !strings.Contains(rules, `oifname "mfhaaaaaaaaaa" drop;`) {
		t.Fatal("未阻止其他宿主主动访问虚拟机", rules)
	}
}
