package network

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func probe(protocol, address, source string) error {
	d := net.Dialer{Timeout: 400 * time.Millisecond}
	if source != "" {
		d.LocalAddr = &net.TCPAddr{IP: net.ParseIP(source)}
	}
	c, err := d.Dial(protocol, address)
	if err != nil {
		return err
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(400 * time.Millisecond))
	if protocol == "udp" {
		if _, err = c.Write([]byte("ok")); err != nil {
			return err
		}
	}
	b := make([]byte, 2)
	_, err = io.ReadFull(c, b)
	if err != nil {
		return err
	}
	if string(b) != "ok" {
		return fmt.Errorf("响应无效")
	}
	return nil
}

// 子进程由 ip netns exec 放入独立命名空间，不切换测试进程线程的 namespace。
func TestNetworkIO(t *testing.T) {
	mode := os.Getenv("MONKEYAI_NETWORK_IO")
	if mode == "" {
		t.Skip("独立网络测试的子进程入口")
	}
	if mode == "probe" {
		err := probe(os.Getenv("PROTOCOL"), os.Getenv("ADDRESS"), os.Getenv("SOURCE"))
		if (err == nil) != (os.Getenv("EXPECT") == "true") {
			t.Fatalf("探测结果错误: %v", err)
		}
		return
	}
	if mode != "server" {
		t.Fatal("测试模式无效")
	}
	for _, port := range []int{22, 53, 80, 443, 853, 4444} {
		l, err := net.Listen("tcp4", ":"+strconv.Itoa(port))
		if err != nil {
			t.Fatal(err)
		}
		defer l.Close()
		go func() {
			for {
				c, err := l.Accept()
				if err != nil {
					return
				}
				c.Write([]byte("ok"))
				c.Close()
			}
		}()
	}
	addresses := []string{"11.0.0.2", "1.1.1.1", "8.8.8.8"}
	if os.Getenv("UDP_ADDRESSES") == "-" {
		addresses = nil
	}
	for _, address := range addresses {
		for _, port := range []int{53, 443, 853} {
			l, err := net.ListenPacket("udp4", net.JoinHostPort(address, strconv.Itoa(port)))
			if err != nil {
				t.Fatal(err)
			}
			defer l.Close()
			go func() {
				b := make([]byte, 100)
				for {
					_, addr, err := l.ReadFrom(b)
					if err != nil {
						return
					}
					l.WriteTo([]byte("ok"), addr)
				}
			}()
		}
	}
	if err := os.WriteFile(os.Getenv("READY"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	<-t.Context().Done()
}

func TestLinuxPacketPolicy(t *testing.T) {
	if os.Getenv("MONKEYAI_TEST_NETWORK") != "1" {
		t.Skip("需要独立 Linux 测试容器")
	}
	if raw, err := os.ReadFile("/monkeyai-network-test"); err != nil || string(raw) != "isolated\n" {
		t.Fatal("缺少独立测试容器标记")
	}
	ctx := t.Context()
	command := func(args ...string) {
		t.Helper()
		if _, err := ip(ctx, args...); err != nil {
			t.Fatal(err)
		}
	}
	// 该测试独占可销毁容器，将默认出口连至模拟公网，完全不依赖互联网。
	target := "mae-test-target"
	command("netns", "add", target)
	defer ip(context.Background(), "netns", "del", target)
	command("link", "add", "mae-test-wan", "type", "veth", "peer", "name", "mae-test-peer")
	defer ip(context.Background(), "link", "delete", "mae-test-wan")
	command("link", "set", "mae-test-peer", "netns", target)
	command("address", "add", "11.0.0.1/32", "dev", "mae-test-wan")
	command("link", "set", "mae-test-wan", "up")
	command("-n", target, "link", "set", "mae-test-peer", "up")
	command("-n", target, "link", "set", "lo", "up")
	for _, addr := range []string{"11.0.0.2", "10.20.0.2", "10.20.0.3", "169.254.169.254", "100.100.100.200", "168.63.129.16", "1.1.1.1", "8.8.8.8"} {
		command("-n", target, "address", "add", addr+"/32", "dev", "mae-test-peer")
	}
	command("-n", target, "route", "add", "default", "via", "11.0.0.1", "dev", "mae-test-peer", "onlink")
	command("route", "replace", "default", "dev", "mae-test-wan")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	startServer := func(namespace string) {
		t.Helper()
		ready := filepath.Join(t.TempDir(), "ready")
		args := []string{executable, "-test.run=^TestNetworkIO$", "-test.timeout=90s"}
		if namespace != "" {
			args = append([]string{"ip", "netns", "exec", namespace}, args...)
		}
		server := exec.Command(args[0], args[1:]...)
		server.Env = append(os.Environ(), "MONKEYAI_NETWORK_IO=server", "READY="+ready)
		if namespace != target {
			server.Env = append(server.Env, "UDP_ADDRESSES=-")
		}
		if err := server.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { server.Process.Kill(); server.Wait() })
		deadline := time.Now().Add(5 * time.Second)
		for {
			if _, err := os.Stat(ready); err == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("模拟服务未就绪")
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	startServer(target)
	startServer("")
	m, _ := manager(t)
	m.kernel = local{}
	m.read = func() (Config, error) {
		c := config()
		c.Services = []Service{{"10.20.0.2", []uint16{443}}}
		return c, nil
	}
	s := spec()
	s.InstanceID = t.Name() + time.Now().Format("150405.000000000")
	defer func() {
		if err := m.Remove(context.Background(), s); err != nil {
			t.Error(err)
		}
	}()
	if _, err := m.Ensure(ctx, s); err != nil {
		t.Fatal(err)
	}
	b, err := m.load(s)
	if err != nil {
		t.Fatal(err)
	}
	startServer(b.name())
	probeIn := func(namespace, protocol, address, source string, allow bool) {
		t.Helper()
		_, err := run(ctx, "ip", []string{"netns", "exec", namespace, executable, "-test.run=^TestNetworkIO$"}, nil, "MONKEYAI_NETWORK_IO=probe", "PROTOCOL="+protocol, "ADDRESS="+address, "SOURCE="+source, "EXPECT="+strconv.FormatBool(allow))
		if err != nil {
			t.Fatal(err)
		}
	}
	// 入站测试同时确认宿主和实例各自的服务实际监听，避免误把未监听当成隔离成功。
	if err := probe("tcp", "11.0.0.1:80", ""); err != nil {
		t.Fatal(err)
	}
	probeIn(b.name(), "tcp", b.Connection.Address+":80", "", true)
	if err := probe("tcp", b.Connection.Address+":80", ""); err == nil {
		t.Fatal("宿主能主动连接环境")
	}
	probeIn(b.name(), "tcp", "11.0.0.1:80", "", false)
	other := s
	other.EnvironmentID = "other"
	other.InstanceID += "-other"
	if _, err := m.Ensure(ctx, other); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := m.Remove(context.Background(), other); err != nil {
			t.Error(err)
		}
	}()
	otherBinding, err := m.load(other)
	if err != nil {
		t.Fatal(err)
	}
	probeIn(otherBinding.name(), "tcp", "11.0.0.2:80", "", true)
	probeIn(otherBinding.name(), "tcp", b.Connection.Address+":80", "", false)
	cases := []struct {
		protocol, address string
		allow             bool
	}{
		{"tcp", "11.0.0.2:22", true}, {"tcp", "11.0.0.2:80", true}, {"tcp", "11.0.0.2:443", true},
		{"tcp", "11.0.0.2:4444", false}, {"udp", "11.0.0.2:443", false},
		{"tcp", "1.1.1.1:53", true}, {"udp", "1.1.1.1:53", true},
		{"tcp", "8.8.8.8:53", false}, {"udp", "8.8.8.8:53", false},
		{"tcp", "1.1.1.1:853", false}, {"udp", "1.1.1.1:853", false},
		{"tcp", "10.20.0.2:443", true}, {"tcp", "10.20.0.2:80", false}, {"tcp", "10.20.0.3:443", false},
		{"tcp", "169.254.169.254:80", false}, {"tcp", "100.100.100.200:80", false}, {"tcp", "168.63.129.16:80", false},
	}
	for _, tc := range cases {
		t.Run(tc.protocol+tc.address, func(t *testing.T) {
			if err := probe(tc.protocol, tc.address, ""); err != nil {
				t.Fatal("模拟服务基线不可达", err)
			}
			_, err := run(ctx, "ip", []string{"netns", "exec", b.name(), executable, "-test.run=^TestNetworkIO$"}, nil, "MONKEYAI_NETWORK_IO=probe", "PROTOCOL="+tc.protocol, "ADDRESS="+tc.address, "EXPECT="+strconv.FormatBool(tc.allow))
			if err != nil {
				t.Fatal(err)
			}
		})
	}
	// 宿主入站和伪造的环境源地址不能借公网放行规则建立连接。
	command("-n", b.name(), "address", "add", "10.240.0.100/32", "dev", "eth0")
	for _, tc := range []struct{ address, source string }{{"11.0.0.2:80", "10.240.0.100"}, {"11.0.0.1:80", ""}} {
		if _, err := run(ctx, "ip", []string{"netns", "exec", b.name(), executable, "-test.run=^TestNetworkIO$"}, nil, "MONKEYAI_NETWORK_IO=probe", "PROTOCOL=tcp", "ADDRESS="+tc.address, "SOURCE="+tc.source, "EXPECT=false"); err != nil {
			t.Fatal(err)
		}
	}
}
