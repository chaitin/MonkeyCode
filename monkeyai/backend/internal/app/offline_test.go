package app

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func splitIngress(t *testing.T, image, control, proxy string) string {
	t.Helper()
	data, err := os.ReadFile("../../../admin/nginx.conf")
	if err != nil {
		t.Fatal(err)
	}
	conf := string(data)
	for host, addr := range map[string]string{"backend": control, "monkeyai-proxy": proxy} {
		u, err := url.Parse(addr)
		if err != nil {
			t.Fatal(err)
		}
		conf = strings.Replace(conf, "server "+host+":8080 resolve;", "server host.docker.internal:"+u.Port()+";", 1)
	}
	path := filepath.Join(t.TempDir(), "nginx.conf")
	if err := os.WriteFile(path, []byte(conf), 0644); err != nil {
		t.Fatal(err)
	}
	docker := func(args ...string) string {
		t.Helper()
		out, err := exec.CommandContext(t.Context(), "docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("docker %s: %s", args[0], out)
		}
		return strings.TrimSpace(string(out))
	}
	id := docker("create", "--tmpfs", "/tmp", "--add-host", "host.docker.internal:host-gateway", "-p", "127.0.0.1::8080", image)
	t.Cleanup(func() {
		if out, err := exec.Command("docker", "rm", "-f", id).CombinedOutput(); err != nil {
			t.Errorf("清理测试入口失败：%s", out)
		}
	})
	docker("cp", path, id+":/etc/nginx/nginx.conf")
	docker("start", id)
	base := "http://" + docker("port", id, "8080")
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get(base + "/api/admin/v1/me")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 401 {
				return base
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("测试入口未连通管理服务")
	return ""
}

func TestControlOffline(t *testing.T) {
	pool := designAppDatabase(t)
	ctx := t.Context()
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	var modelCalls, toolCalls atomic.Int32
	gate := make(chan struct{})
	release := sync.OnceFunc(func() { close(gate) })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/chat/completions") {
			if modelCalls.Add(1) == 1 {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n")
				w.(http.Flusher).Flush()
				select {
				case <-gate:
				case <-r.Context().Done():
					return
				}
				fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1}}\n\ndata: [DONE]\n\n")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"choices":[{"message":{"content":"second"}}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`)
			return
		}
		var rpc struct {
			ID     any
			Method string
		}
		_ = json.NewDecoder(r.Body).Decode(&rpc)
		var result any
		switch rpc.Method {
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "initialize":
			result = resource.Object{"protocolVersion": "2025-11-25"}
		case "tools/list":
			result = resource.Object{"tools": []any{resource.Object{"name": "lookup", "inputSchema": resource.Object{"type": "object"}}}}
		case "tools/call":
			toolCalls.Add(1)
			result = resource.Object{"content": []any{resource.Object{"type": "text", "text": "ok"}}}
		default:
			t.Errorf("意外 MCP 方法 %q", rpc.Method)
			return
		}
		resource.JSON(r.Context(), w, 200, resource.Object{"jsonrpc": "2.0", "id": rpc.ID, "result": result})
	}))
	defer upstream.Close()
	defer release()
	cfg := config.Config{PublicURL: "http://localhost:8080", Role: config.RoleControl}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	h, err := newMemberTestHandler(ctx, logger, pool, cfg)
	if err != nil {
		t.Fatal(err)
	}
	control := httptest.NewServer(planeHandler(cfg.Role, h))
	defer control.Close()
	cfg.Role = config.RoleProxy
	h, err = newMemberTestHandler(ctx, logger, pool, cfg)
	if err != nil {
		t.Fatal(err)
	}
	proxy := httptest.NewServer(planeHandler(cfg.Role, h))
	defer proxy.Close()
	base := proxy.URL
	if image := os.Getenv("MONKEYAI_TEST_NGINX_IMAGE"); image != "" {
		base = splitIngress(t, image, control.URL, proxy.URL)
	}
	user, session := resource.ID(), resource.ID()
	if _, err = pool.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1,'test','offline@example.com')", user); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,'refresh',now()+interval '1 hour',now()+interval '2 hours')`, user, fmt.Sprintf("%x", sha256.Sum256([]byte("setup")))); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	post := func(path, key string, body any) *http.Response {
		t.Helper()
		b, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(ctx, "POST", base+path, bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("X-MAI-Session-ID", session)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode/100 != 2 {
			defer res.Body.Close()
			b, _ := io.ReadAll(res.Body)
			t.Fatalf("%s: %d %s", path, res.StatusCode, b)
		}
		return res
	}
	call := func(path, key string, body any) resource.Object {
		t.Helper()
		res := post(path, key, body)
		defer res.Body.Close()
		var out resource.Object
		if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	key := call("/api/v1/api-keys", "setup", resource.Object{"name": "测试", "scopes": []string{"model:invoke", "mcp:invoke"}}).String("api_key")
	model := call("/api/v1/models", "setup", resource.Object{"model_id": "sample", "display_name": "测试模型", "protocol": "openai_chat_completions", "base_url": upstream.URL, "api_key": "fixture", "advanced_config": resource.Object{"context_window_tokens": 8192, "max_output_tokens": 100}}).String("id")
	conn := call("/api/v1/connectors", "setup", resource.Object{"name": "测试", "url": upstream.URL, "authorization_mode": "none", "authorization_method": "http_header"}).String("id")
	call("/api/v1/connectors/"+conn+"/test", "setup", nil)
	body := resource.Object{"model": model, "messages": []resource.Object{{"role": "user", "content": "one"}}, "stream": true}
	r := post("/v1/chat/completions", key, body)
	defer r.Body.Close()
	reader := bufio.NewReader(r.Body)
	first, err := reader.ReadString('\n')
	if err != nil || !strings.Contains(first, "first") {
		t.Fatalf("首包 %q: %v", first, err)
	}
	control.Close()
	if base != proxy.URL {
		res, err := client.Get(base + "/api/admin/v1/me")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 502 {
			t.Fatalf("预期管理面不可用，得到 %d", res.StatusCode)
		}
	}
	release()
	rest, err := io.ReadAll(reader)
	if err != nil || !bytes.Contains(rest, []byte("[DONE]")) {
		t.Fatalf("模型流中断: %q %v", rest, err)
	}
	tool := call("/mcp/connectors/"+conn, key, resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": "lookup", "arguments": resource.Object{}}})
	if tool["result"] == nil || toolCalls.Load() != 1 {
		t.Fatalf("工具未完成: %v", tool)
	}
	body["stream"] = false
	call("/v1/chat/completions", key, body)
	if modelCalls.Load() != 2 {
		t.Fatalf("模型调用次数 %d", modelCalls.Load())
	}
	if err := h.(*applicationHandler).proxy.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM model_calls WHERE session_id=$1", session).Scan(&count); err != nil || count != 2 {
		t.Fatalf("同一会话模型记录 %d: %v", count, err)
	}
}
