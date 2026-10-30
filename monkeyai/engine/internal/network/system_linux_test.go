package network

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestTableJSONRequiresCompleteOwnership(t *testing.T) {
	tables, err := readTables([]byte(`{"nftables":[{"metainfo":{}},{"table":{"family":"inet","name":"mae_test","comment":"owner"}},{"chain":{}}]}`))
	if err != nil || len(tables) != 1 || tables[0].Comment != "owner" {
		t.Fatal(tables, err)
	}
	for _, raw := range []string{`null`, `{}`, `{"nftables":{}}`} {
		if _, err := readTables([]byte(raw)); err == nil {
			t.Fatal("接受无效表清单")
		}
	}
}

func TestLinuxNetworkLifecycle(t *testing.T) {
	if os.Getenv("MONKEYAI_TEST_NETWORK") != "1" {
		t.Skip("仅在独立 Linux 测试容器内运行真实 CNI/nftables")
	}
	marker, err := os.ReadFile("/monkeyai-network-test")
	if err != nil || string(marker) != "isolated\n" {
		t.Fatal("缺少独立测试容器标记")
	}
	m, _ := manager(t)
	m.kernel = local{}
	s := spec()
	s.InstanceID = t.Name() + time.Now().Format("150405.000000000")
	defer func() {
		if err := m.Remove(t.Context(), s); err != nil {
			t.Error("清理网络", err)
		}
	}()
	a, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	if a.Namespace == "" || a.Resolver == "" {
		t.Fatal("缺少网络附件")
	}
	b, err := m.load(s)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := m.Check(t.Context(), s); err != nil {
			t.Fatal("重复更新防火墙失败", err)
		}
		again, err := m.Ensure(t.Context(), s)
		if err != nil || again != a {
			t.Fatal("重复创建网络", err)
		}
	}
	found, err := tables(t.Context(), b)
	if err != nil || !found["inet"] || !found["netdev"] {
		t.Fatal("防火墙表缺失", found, err)
	}
	raw, err := run(t.Context(), "nft", []string{"list", "table", "inet", table(b)}, nil)
	if err != nil || !strings.Contains(string(raw), "masquerade") {
		t.Fatal("缺少源地址转换", err)
	}
	if err := m.Remove(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(a.Namespace); !os.IsNotExist(err) {
		t.Fatal("netns 没有清理", err)
	}
	found, err = tables(t.Context(), b)
	if err != nil || len(found) != 0 {
		t.Fatal("防火墙表没有清理", found, err)
	}
}

func TestTableOwnershipRequiresExactHeader(t *testing.T) {
	b := binding{EnvironmentID: "env", InstanceID: "instance", Config: config()}
	raw := "table inet " + table(b) + " {\n comment \"" + owner(b) + "\"\n chain test {}\n}\n"
	if !tableOwned([]byte(raw), "inet", b) {
		t.Fatal("拒绝有效归属")
	}
	for _, bad := range []string{strings.Replace(raw, owner(b), "foreign", 1), strings.Replace(raw, "inet", "ip", 1), strings.Replace(raw, "comment ", "chain comment ", 1), "table inet foreign {\n" + raw} {
		if tableOwned([]byte(bad), "inet", b) {
			t.Fatal("接管未知表")
		}
	}
}
