package dockernet

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
)

func TestNetworkRejectsForeignOwnership(t *testing.T) {
	n := Network{ID: strings.Repeat("a", 64), Name: "test", Driver: "bridge", Labels: map[string]string{dockerapi.Owner: "engine", "io.monkeyai.spec": "spec", "io.monkeyai.dns": "1.1.1.1"}, Options: map[string]string{"com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.enable_ip_masquerade": "true"}}
	n.IPAM.Config = append(n.IPAM.Config, struct{ Subnet, Gateway string }{"172.28.0.0/16", "172.28.0.1"})
	if err := n.validate("test", "spec", "instance"); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Network){func(n *Network) { n.Internal = true }, func(n *Network) { n.EnableIPv6 = true }, func(n *Network) { n.ID = "bad" }, func(n *Network) { n.Containers = map[string]struct{ Name string }{"other": {"foreign"}} }} {
		bad := n
		change(&bad)
		if bad.validate("test", "spec", "instance") == nil {
			t.Fatal("接受未知网络")
		}
	}
	r := rules(n, "spec")
	for _, want := range []string{"fib daddr type local drop", "169.254.0.0/16", "100.100.100.200/32", "tcp dport { 22, 80, 443 } accept", "meta nfproto != ipv4 drop"} {
		if !strings.Contains(r, want) {
			t.Fatal(want)
		}
	}
}
func TestNetworkContainerNames(t *testing.T) {
	for _, test := range []struct {
		name     string
		expected string
		attached []string
		valid    bool
	}{
		{"unattached", "instance-id", nil, true},
		{"instance", "instance-id", []string{"instance-id"}, true},
		{"legacy", "network-key", []string{"network-key"}, true},
		{"foreign", "instance-id", []string{"foreign"}, false},
		{"other-instance", "instance-id", []string{"other-instance-id"}, false},
		{"wrong-name", "instance-id", []string{"network-key"}, false},
		{"extra", "instance-id", []string{"instance-id", "foreign"}, false},
		{"duplicate", "instance-id", []string{"instance-id", "instance-id"}, false},
		{"missing-expected", "", []string{""}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			n := Network{ID: strings.Repeat("a", 64), Name: "network-key", Driver: "bridge", Labels: map[string]string{dockerapi.Owner: "engine", "io.monkeyai.spec": "spec", "io.monkeyai.dns": "1.1.1.1"}, Options: map[string]string{"com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.enable_ip_masquerade": "true"}, Containers: map[string]struct{ Name string }{}}
			n.IPAM.Config = append(n.IPAM.Config, struct{ Subnet, Gateway string }{"172.28.0.0/16", "172.28.0.1"})
			for i, name := range test.attached {
				n.Containers[fmt.Sprint(i)] = struct{ Name string }{name}
			}
			if err := n.validate(n.Name, "spec", test.expected); (err == nil) != test.valid {
				t.Fatalf("valid=%t err=%v", test.valid, err)
			}
		})
	}
}

func TestDockerNetworkIntegration(t *testing.T) {
	if os.Getenv("MONKEYAI_DOCKER_NETWORK_TEST") != "1" {
		t.Skip("仅一次性 Docker 容器")
	}
	if _, err := os.Stat("/monkeyai-docker-test"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	c := dockerapi.New(dockerapi.Socket)
	defer c.Close()
	name := fmt.Sprintf("network-test-%d", time.Now().UnixNano())
	containerName := name + "-instance"
	fingerprint := strings.Repeat("b", 64)
	n, err := Ensure(ctx, c, name, fingerprint, containerName)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		clean, stop := context.WithTimeout(context.Background(), 20*time.Second)
		defer stop()
		_ = c.Do(clean, "DELETE", "/containers/"+containerName+"?force=true", nil, nil)
		if err := Remove(clean, c, name, fingerprint, containerName); err != nil {
			t.Error(err)
		}
	})
	resolver := filepath.Join(t.TempDir(), "resolv.conf")
	if err = os.WriteFile(resolver, []byte(n.Resolver()), 0644); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"Image": "busybox:1.37.0", "User": "1000:1000", "Cmd": []string{"sleep", "300"}, "HostConfig": map[string]any{"Mounts": []map[string]any{{"Type": "bind", "Source": resolver, "Target": "/etc/resolv.conf", "ReadOnly": true}}, "Runtime": dockerapi.Runtime, "ReadonlyRootfs": true, "NetworkMode": name, "CapDrop": []string{"ALL"}, "SecurityOpt": []string{"no-new-privileges:true"}}}
	if err = c.Do(ctx, "POST", "/containers/create?name="+containerName, body, nil); err != nil {
		t.Fatal(err)
	}
	if err = c.Do(ctx, "POST", "/containers/"+containerName+"/start", nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = Inspect(ctx, c, name, fingerprint, containerName); err != nil {
		t.Fatal("实例 ID 与网络名不同时运行容器校验失败", err)
	}
	run := func(command string) error {
		out, err := exec.CommandContext(ctx, "docker", "exec", containerName, "sh", "-c", command).CombinedOutput()
		if err != nil {
			return fmt.Errorf("%s: %w: %s", command, err, out)
		}
		return nil
	}
	if err = run("nslookup example.com >/dev/null"); err != nil {
		t.Fatal("Docker DNS", err)
	}
	// 固定公网地址避免开发机代理的 fake-IP DNS 改变测试目标。
	if err = run(`(printf 'GET / HTTP/1.0\r\nHost: 1.1.1.1\r\n\r\n'; sleep 2) | nc -w 5 1.1.1.1 80 | grep -q '^HTTP/1.[01] [23][0-9][0-9]'`); err != nil {
		t.Fatal("公网访问", err)
	}
	dropped := func() uint64 {
		t.Helper()
		raw, err := runNft(ctx, n)
		if err != nil {
			t.Fatal(err)
		}
		var report struct {
			Nftables []struct {
				Rule *struct {
					Expr []struct {
						Counter *struct{ Packets uint64 }
					}
				}
			}
		}
		if err := json.Unmarshal(raw, &report); err != nil {
			t.Fatal(err)
		}
		var total uint64
		for _, item := range report.Nftables {
			if item.Rule != nil {
				for _, expr := range item.Rule.Expr {
					if expr.Counter != nil {
						total += expr.Counter.Packets
					}
				}
			}
		}
		return total
	}
	for _, address := range []string{n.IPAM.Config[0].Gateway, "169.254.169.254", "100.100.100.200"} {
		before := dropped()
		if err = run("nc -w 2 " + address + " 80 </dev/null"); err == nil {
			t.Fatal("允许受保护目的", address)
		}
		if dropped() <= before {
			t.Fatal("未观测到防火墙实际拒绝流量", address)
		}
	}
	raw, err := runNft(ctx, n)
	if err != nil {
		t.Fatal(err)
	}
	var table map[string]any
	if json.Unmarshal(raw, &table) != nil {
		t.Fatal("规则检查失败")
	}
	t.Log("gVisor 环境 DNS、公网 HTTP、宿主与元数据地址拒绝均通过，已核对丢包计数")
}
func runNft(ctx context.Context, n Network) ([]byte, error) {
	return run(ctx, []string{"-j", "list", "table", "inet", table(n)}, "")
}
