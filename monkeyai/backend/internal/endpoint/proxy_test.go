package endpoint

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestNginxUpgrade(t *testing.T) {
	image := os.Getenv("MONKEYAI_TEST_NGINX_IMAGE")
	if image == "" {
		t.Skip("设置 MONKEYAI_TEST_NGINX_IMAGE 通过本地 Docker 验证实际 Nginx 桥接入口")
	}
	f := newFixture(t)
	upstream, err := url.Parse(f.server.URL)
	if err != nil {
		t.Fatal(err)
	}
	config := fmt.Sprintf("events {}\nhttp { upstream monkeyai_backend { server host.docker.internal:%s; } server { listen 8080; include /etc/nginx/bridge-app.conf; } }\n", upstream.Port())
	configPath := filepath.Join(t.TempDir(), "nginx.conf")
	if err = os.WriteFile(configPath, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	appPath, err := filepath.Abs("../../../admin/nginx/app.conf")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "docker", "create", "--label", "monkeyai.task=endpoint-bridge-test", "--add-host", "host.docker.internal:host-gateway", "-p", "127.0.0.1::8080", image).CombinedOutput()
	if err != nil {
		t.Fatalf("启动 Nginx: %s %v", data, err)
	}
	id := strings.TrimSpace(string(data))
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if data, err := exec.CommandContext(ctx, "docker", "rm", "-f", id).CombinedOutput(); err != nil {
			t.Errorf("停止测试 Nginx: %s %v", data, err)
		}
	})
	for _, pair := range [][2]string{{configPath, "/etc/nginx/nginx.conf"}, {appPath, "/etc/nginx/bridge-app.conf"}} {
		if data, err := exec.CommandContext(ctx, "docker", "cp", pair[0], id+":"+pair[1]).CombinedOutput(); err != nil {
			t.Fatalf("复制 Nginx 配置: %s %v", data, err)
		}
	}
	if data, err := exec.CommandContext(ctx, "docker", "start", id).CombinedOutput(); err != nil {
		t.Fatalf("启动 Nginx: %s %v", data, err)
	}
	data, err = exec.CommandContext(ctx, "docker", "port", id, "8080").Output()
	if err != nil {
		t.Fatal(err)
	}
	address := strings.TrimSpace(string(data))
	var conn *websocket.Conn
	for range 30 {
		conn, _, err = websocket.Dial(ctx, "ws://"+address+"/api/v1/endpoints/connect", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer owner"}}})
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	if err != nil {
		logs, _ := exec.CommandContext(ctx, "docker", "logs", id).CombinedOutput()
		t.Fatalf("代理 Upgrade 失败: %v\n%s", err, logs)
	}
	defer conn.CloseNow()
	writeWS(t, conn, Hello{Type: "hello", Versions: []int{1}, MachineID: machineA, Profile: Profile{"代理测试", "macos", "15", "arm64", "1"}})
	readWS(t, conn, "welcome")
	readWS(t, conn, "directory.snapshot")
}
