//go:build linux

package vmnet

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestNetworkNamespaceIntegration(t *testing.T) {
	if os.Getenv("MONKEYAI_NET_TEST") != "1" {
		t.Skip("显式启用Linux网络创建与回收验收")
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		t.Fatal(err)
	}
	id := hex.EncodeToString(random[:])
	manager := networkFixture(t)
	lease, err := manager.Prepare(t.Context(), id)
	if err != nil {
		t.Fatal("创建隔离网络失败，保留该测试目录供核对", err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := manager.Remove(cleanup, id, lease); err != nil {
			t.Error("隔离网络回收失败", err)
		}
	}()
	if err := manager.Verify(t.Context(), id, lease); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remove(t.Context(), id, lease); err != nil {
		t.Fatal(err)
	}
	if present, err := manager.HasAllocation(id); err != nil || present {
		t.Fatal("已移除网络仍有登记", present, err)
	}
}

func TestNetworkRulesIntegration(t *testing.T) {
	if os.Getenv("MONKEYAI_NFT_TEST") != "1" {
		t.Skip("显式启用Linux nftables语法验收")
	}
	manager := networkFixture(t)
	for _, policy := range []string{"public-only", "isolated"} {
		manager.config.Policy = policy
		rules := manager.rules(record{ID: strings.Repeat("c", 64), Slot: 123})
		cmd := exec.CommandContext(t.Context(), "nft", "--check", "--file", "-")
		cmd.Stdin = strings.NewReader(rules)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("策略%s语法失败: %s %v", policy, output, err)
		}
	}
}
