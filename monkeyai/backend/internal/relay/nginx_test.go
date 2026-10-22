package relay

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestNginxRelay(t *testing.T) {
	image := os.Getenv("MONKEYAI_TEST_NGINX_IMAGE")
	if image == "" {
		t.Skip("设置 MONKEYAI_TEST_NGINX_IMAGE 运行 Nginx 集成验证")
	}
	f := newFixture(t)
	upstream, _ := url.Parse(f.server.URL)
	config := fmt.Sprintf("events {}\nhttp { upstream monkeyai_backend { server host.docker.internal:%s; } server { listen 8080; include /etc/nginx/relay-app.conf; } }\n", upstream.Port())
	configPath := filepath.Join(t.TempDir(), "nginx.conf")
	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	command := func(args ...string) string {
		t.Helper()
		data, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("Docker %s 失败：%s", args[0], data)
		}
		return strings.TrimSpace(string(data))
	}
	id := command("create", "--label", "monkeyai.task=remote-runtime-test", "--add-host", "host.docker.internal:host-gateway", "-p", "127.0.0.1::8080", image)
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if data, err := exec.CommandContext(cleanup, "docker", "rm", "-f", id).CombinedOutput(); err != nil {
			t.Errorf("清理测试 Nginx：%s", data)
		}
	})
	appPath, err := filepath.Abs("../../../admin/nginx/app.conf")
	if err != nil {
		t.Fatal(err)
	}
	command("cp", configPath, id+":/etc/nginx/nginx.conf")
	command("cp", appPath, id+":/etc/nginx/relay-app.conf")
	command("start", id)
	command("exec", id, "nginx", "-t")
	address := command("port", id, "8080")
	f.server = &httptest.Server{URL: "http://" + address}
	// 等待 Nginx 监听，实际握手和业务流仍由同一后端处理。
	for range 30 {
		req, _ := http.NewRequestWithContext(ctx, "GET", f.server.URL+"/api/v1/endpoint-bridge", nil)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			resp.Body.Close()
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	runtime := f.runtime(t)
	scopes := []string{"session:read", "session:control", "files:write"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	payload := strings.Repeat("中转流式上传", 10000)
	req, _ := http.NewRequestWithContext(ctx, "PUT", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/uploads/test", strings.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+connection.Ticket)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(body) != payload {
		t.Fatalf("Nginx 上传失败，状态=%d", resp.StatusCode)
	}
	ws, response, err := dialTerminal(ctx, f, runtime, connection.Ticket, "")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if ws.Subprotocol() != terminalProtocol || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("Nginx 丢失终端握手头")
	}
	message := []byte(`{"type":"heartbeat","nonce":"nginx-terminal"}`)
	if err := ws.Write(ctx, websocket.MessageText, message); err != nil {
		t.Fatal(err)
	}
	if _, out, err := ws.Read(ctx); err != nil || string(out) != string(message) {
		t.Fatalf("Nginx 终端转发失败: %s %v", out, err)
	}
	logs := command("logs", id)
	if strings.Contains(logs, connection.Ticket) {
		t.Fatal("Nginx 日志包含票据")
	}
}
