package relay

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestRelayHTTPOrigins(t *testing.T) {
	dir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, origin := range []string{
		"http://ai.example.com:8080", "http://203.0.113.20:8080", "http://10.0.0.20:8080",
		"http://172.16.0.20:8080", "http://192.168.1.20:8080", "http://monkeyai.internal:8080",
		"http://[fd00::20]:8080", "http://[::1]:8080", "http://localhost:8080", "http://127.0.0.1:8080",
		"https://ai.example.com", "https://ai.example.com:8443",
	} {
		t.Run(origin, func(t *testing.T) {
			s, err := NewService(nil, nil, nil, logger, Config{StateDir: dir, PublicURL: origin})
			if err != nil {
				t.Fatal(err)
			}
			metadata := s.Metadata()
			if metadata["bridge_url"] != strings.Replace(origin, "http", "ws", 1)+"/api/v1/endpoint-bridge" || metadata["files_origin"] != origin {
				t.Fatal("发现地址没有沿用配置协议")
			}
		})
	}
}

func TestRelayRejectsInvalidOrigins(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, origin := range []string{"ftp://ai.example.com", "ws://ai.example.com", "//ai.example.com", "http:///missing-host", "http://:8080", "http://user:password@ai.example.com", "http://ai.example.com/path", "http://ai.example.com?query=1", "http://ai.example.com?", "http://ai.example.com#fragment", "http://[fd00::1", "http://ai.example.com:invalid"} {
		for _, name := range []string{"MONKEYAI_PUBLIC_URL", "MONKEYAI_RUNTIME_FILES_ORIGIN"} {
			t.Run(name+"/"+origin, func(t *testing.T) {
				config := Config{PublicURL: "http://192.168.1.20:8080", FilesOrigin: "http://203.0.113.20:8080"}
				if name == "MONKEYAI_PUBLIC_URL" {
					config.PublicURL = origin
				} else {
					config.FilesOrigin = origin
				}
				if _, err := NewService(nil, nil, nil, logger, config); err == nil || !strings.Contains(err.Error(), name) {
					t.Fatalf("无效 origin 未被拒绝或错误缺少配置项: %v", err)
				}
			})
		}
	}
}

func TestRelayPublicAndPrivateHTTP(t *testing.T) {
	for _, origin := range []string{"http://203.0.113.20:8080", "http://192.168.1.20:8080"} {
		t.Run(origin, func(t *testing.T) {
			f := newFixtureOrigin(t, origin)
			runtime := f.runtime(t)
			if runtime.ready.PublicAddresses["http_base"] != origin+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/" || runtime.ready.PublicAddresses["files_base"] != origin+"/endpoints/"+runtime.hello.MachineID+"/files/" {
				t.Fatal("握手没有发布配置的 HTTP 业务与文件地址")
			}
			scopes := []string{"session:read", "files:read"}
			connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			ws, _, err := websocket.Dial(ctx, strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/acp", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + connection.Ticket}, "Origin": {origin}}})
			if err != nil {
				t.Fatal(err)
			}
			defer ws.CloseNow()
			if err := ws.Write(ctx, websocket.MessageText, []byte("session/list")); err != nil {
				t.Fatal(err)
			}
			if _, body, err := ws.Read(ctx); err != nil || string(body) != "session/list" {
				t.Fatalf("HTTP 部署无法通过 ws 访问业务: %v", err)
			}
			raw := f.fileToken(t, runtime, "test.txt")
			request, _ := http.NewRequestWithContext(ctx, "GET", f.server.URL+"/endpoints/"+runtime.hello.MachineID+"/files/"+raw+"/test.txt", nil)
			public, _ := url.Parse(origin)
			request.Host = public.Host
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode != 200 || string(body) != "目标文件内容" || response.Header.Get("Content-Disposition") != "attachment" {
				t.Fatal("HTTP 部署文件授权下载失败")
			}
		})
	}
}
