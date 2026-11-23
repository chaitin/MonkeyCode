package relay

import (
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestControlSocket(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "relay-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	parent := filepath.Dir(controlPath(dir))
	if err := os.Mkdir(parent, 0755); err != nil {
		t.Fatal(err)
	}
	if ln, err := ListenControl(dir); err == nil {
		ln.Close()
		t.Fatal("不应在可由其他用户访问的目录监听")
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	addr := &net.UnixAddr{Name: controlPath(dir), Net: "unix"}
	stale, err := net.ListenUnix("unix", addr)
	if err != nil {
		t.Fatal(err)
	}
	stale.SetUnlinkOnClose(false)
	if err := stale.Close(); err != nil {
		t.Fatal(err)
	}
	ln, err := ListenControl(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	if other, err := ListenControl(dir); err == nil {
		other.Close()
		t.Fatal("不应占用已有监听器的地址")
	}
	revoked := make(chan string, 1)
	r := &Service{}
	server := &http.Server{Handler: r.ControlHandler(func(id string) { revoked <- id })}
	done := make(chan error, 1)
	go func() { done <- server.Serve(ln) }()
	t.Cleanup(func() { server.Close(); <-done })
	client := NewControl(dir)
	defer client.Close()
	const user = "00000000-0000-4000-8000-000000000001"
	const machine = "00000000-0000-4000-8000-000000000002"
	if status, _, _, err := client.RuntimeStatus(t.Context(), user, machine); err != nil || status != "offline" {
		t.Fatalf("获取状态：%q %v", status, err)
	}
	if ready, err := client.RuntimeReady(t.Context(), user, machine); err != nil || ready {
		t.Fatalf("读取就绪：%t %v", ready, err)
	}
	if err := client.RevokeGrant(t.Context(), "bad-id"); err == nil {
		t.Fatal("无效授权不应送达 Relay")
	}
	if err := client.RevokeGrant(t.Context(), machine); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-revoked:
		if id != machine {
			t.Fatalf("撤销了错误授权：%q", id)
		}
	case <-time.After(time.Second):
		t.Fatal("撤销未送达 Relay")
	}
}
