package relay

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNginxSafeLogging(t *testing.T) {
	image := os.Getenv("MONKEYAI_TEST_NGINX_IMAGE")
	if image == "" {
		t.Skip("设置 MONKEYAI_TEST_NGINX_IMAGE 为含 ACME 模块的管理镜像验证日志边界")
	}
	upstream := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", "1234567890abcdef1234567890abcdef")
		_, _ = io.WriteString(w, "data: ok\n\n")
	}))
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	upstream.Listener = listener
	upstream.Start()
	defer upstream.Close()
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	config, err := os.ReadFile("../../../admin/nginx.conf")
	if err != nil {
		t.Fatal(err)
	}
	config = []byte(strings.Replace(string(config), "server backend:8080;", "server host.docker.internal:"+port+";", 1))
	file := filepath.Join(t.TempDir(), "nginx.conf")
	if err := os.WriteFile(file, config, 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	run := func(args ...string) string {
		t.Helper()
		data, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("Docker %s 失败: %v %s", args[0], err, data)
		}
		return strings.TrimSpace(string(data))
	}
	id := run("create", "--label", "monkeyai.test=logging-review", "--add-host", "host.docker.internal:host-gateway", "-p", "127.0.0.1::8080", image)
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = exec.CommandContext(cleanup, "docker", "rm", "-fv", id).Run()
	})
	run("cp", file, id+":/etc/nginx/nginx.conf")
	app, err := filepath.Abs("../../../admin/nginx/app.conf")
	if err != nil {
		t.Fatal(err)
	}
	run("cp", app, id+":/etc/nginx/monkeyai/app.conf")
	run("start", id)
	base := "http://" + run("port", id, "8080/tcp")
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}}
	defer client.CloseIdleConnections()
	get := func(path string, large bool) error {
		request, _ := http.NewRequestWithContext(ctx, "GET", base+path, nil)
		if large {
			request.Header.Set("X-Test", strings.Repeat("x", 20000))
		}
		response, err := client.Do(request)
		if err != nil {
			return err
		}
		_, _ = io.Copy(io.Discard, response.Body)
		return response.Body.Close()
	}
	for i := 0; ; i++ {
		if get("/healthz", false) == nil {
			break
		}
		if i >= 40 {
			t.Fatal("Nginx 未就绪", run("logs", id))
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	expanded := run("exec", id, "nginx", "-T")
	for _, directive := range []string{"client_max_body_size 64m", "client_max_body_size 2064m", "proxy_request_buffering off", "proxy_buffering off", "monkeyai_safe", "error_log /dev/null"} {
		if !strings.Contains(expanded, directive) {
			t.Fatal("展开配置缺少", directive)
		}
	}
	for _, path := range []string{"/oauth/callback?code=private-oauth-code", "/preview/private-path-grant", "/api/v1/endpoints/abc/proxy/cap/private-path-token/mcp", "/private-unknown-path", "/api/v1/models?token=private-query-token"} {
		if err := get(path, false); err != nil {
			t.Fatal(err)
		}
	}
	if err := get("/oauth/callback?code=private-oauth-code", true); err != nil {
		t.Fatal(err)
	}
	upstream.Close()
	if err := get("/oauth/callback?code=private-oauth-code", false); err != nil {
		t.Fatal(err)
	}
	logs := run("logs", id)
	for _, secret := range []string{"private-oauth-code", "private-path-grant", "private-path-token", "private-unknown-path", "private-query-token"} {
		if strings.Contains(logs, secret) {
			t.Fatal("Nginx 日志泄漏", secret)
		}
	}
	associated := false
	for _, line := range strings.Split(logs, "\n") {
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			t.Fatal(err)
		}
		if len(row) != 5 {
			t.Fatal("访问日志包含未约定字段", row)
		}
		if row["route"] == "oauth" && row["request_id"] == "1234567890abcdef1234567890abcdef" {
			associated = true
		}
	}
	if !associated {
		t.Fatal("普通路由缺少后端请求 ID", logs)
	}
}
