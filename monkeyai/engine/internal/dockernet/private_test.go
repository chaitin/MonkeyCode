package dockernet

import (
	"net/netip"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestPrivateCIDRRules(t *testing.T) {
	n := Network{ID: strings.Repeat("a", 64), Labels: map[string]string{"io.monkeyai.dns": "10.2.0.53"}}
	n.IPAM.Config = append(n.IPAM.Config, struct{ Subnet, Gateway string }{"172.28.0.0/16", "172.28.0.1"})
	prefix := netip.MustParsePrefix("10.2.98.116/32")
	if err := ValidatePrivateCIDRs([]netip.Prefix{prefix}); err != nil {
		t.Fatal(err)
	}
	defaultRules, privateRules := rules(n, "test"), rules(n, "test", prefix, netip.MustParsePrefix("10.2.98.0/24"))
	if strings.Contains(defaultRules, prefix.String()) {
		t.Fatal("默认规则放行了私网地址")
	}
	pos := 0
	for _, want := range []string{"fib daddr type local drop", "ip daddr 10.2.0.53 tcp dport 53 accept", "ip daddr 10.2.98.116/32 ct status dnat drop", "ip daddr 10.2.98.116/32 oifname != \"br-aaaaaaaaaaaa\" tcp dport != 53 accept", "ip daddr { " + denied + " } counter drop"} {
		i := strings.Index(privateRules[pos:], want)
		if i < 0 {
			t.Fatalf("未按预期顺序生成规则：%s", want)
		}
		pos += i + len(want)
	}
	if os.Getenv("MONKEYAI_NFT_CHECK_TEST") == "1" {
		cmd := exec.CommandContext(t.Context(), "nft", "--check", "--file", "-")
		cmd.Stdin = strings.NewReader(privateRules)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("nftables 校验失败：%v: %s", err, out)
		}
	}
}
