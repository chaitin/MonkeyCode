package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRemoteSession(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			var initialized, closed atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer upstream-secret" {
					t.Error("上游凭证未注入")
				}
				if r.Method == "DELETE" {
					if r.Header.Get("Mcp-Session-Id") != "upstream-session" {
						t.Error("清理会话错误")
					}
					closed.Store(true)
					w.WriteHeader(204)
					return
				}
				var in request
				if json.NewDecoder(r.Body).Decode(&in) != nil {
					t.Error("请求无效")
				}
				w.Header().Set("Content-Type", "application/json")
				switch in.Method {
				case "initialize":
					w.Header().Set("Mcp-Session-Id", "upstream-session")
					fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}`)
				case "notifications/initialized":
					if r.Header.Get("Mcp-Session-Id") != "upstream-session" || r.Header.Get("MCP-Protocol-Version") != "2025-03-26" {
						t.Error("未沿用握手会话和协商版本")
					}
					initialized.Store(true)
					w.WriteHeader(202)
				case "tools/call":
					if !initialized.Load() || r.Header.Get("Mcp-Session-Id") != "upstream-session" {
						t.Error("调用未正确初始化")
					}
					if !strings.Contains(string(in.Params), "9007199254740993") || !strings.Contains(string(in.Params), `"_meta"`) {
						t.Error("参数精度或元数据丢失")
					}
					response := `{"jsonrpc":"2.0","id":2,"result":{"content":[],"structuredContent":{"value":9007199254740993},"_meta":{"trace":"result"}}}`
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						fmt.Fprint(w, ": heartbeat\r\n\r\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\r\n\r\n")
						fmt.Fprint(w, "event: message\r\ndata: "+strings.Replace(response, `,"result":`, ",\r\ndata: \"result\":", 1)+"\r\n\r\n")
						w.(http.Flusher).Flush()
						<-r.Context().Done()
					} else {
						fmt.Fprint(w, response)
					}
				}
			}))
			defer server.Close()
			remote, err := openRemote(t.Context(), server.URL, map[string]string{"Authorization": "Bearer upstream-secret"})
			if err != nil {
				t.Fatal(err)
			}
			result, err := remote.call(t.Context(), 2, "tools/call", json.RawMessage(`{"name":"search","arguments":{"value":9007199254740993},"_meta":{"trace":"request"}}`))
			remote.close()
			if err != nil || !strings.Contains(string(result), "9007199254740993") || !closed.Load() {
				t.Fatalf("调用结果或会话清理无效: %s %v", result, err)
			}
		})
	}
}

func TestRemoteInvalidResponses(t *testing.T) {
	for _, test := range []struct {
		name, media, body string
		rpc               bool
	}{
		{name: "上游业务错误", media: "application/json", body: `{"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"bad arguments"}}`, rpc: true},
		{name: "缺少版本", media: "application/json", body: `{"id":2,"result":{}}`},
		{name: "请求 ID 不符", media: "application/json", body: `{"jsonrpc":"2.0","id":3,"result":{}}`},
		{name: "结果与错误共存", media: "application/json", body: `{"jsonrpc":"2.0","id":2,"result":{},"error":{"code":1,"message":"err"}}`},
		{name: "缺少错误码", media: "application/json", body: `{"jsonrpc":"2.0","id":2,"error":{"message":"err"}}`},
		{name: "错误值为空", media: "application/json", body: `{"jsonrpc":"2.0","id":2,"error":null}`},
		{name: "HTML 响应", media: "text/html", body: `<html>错误</html>`},
		{name: "截断 JSON", media: "application/json", body: `{"jsonrpc":"2.0","id":2`},
		{name: "无事件边界", media: "text/event-stream", body: "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{}}\n"},
		{name: "响应超限", media: "application/json", body: strings.Repeat(" ", (4<<20)+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", test.media)
				fmt.Fprint(w, test.body)
			}))
			defer server.Close()
			remote := &remoteClient{http: server.Client(), target: server.URL, version: protocolVersion}
			defer remote.close()
			_, err := remote.call(context.Background(), 2, "tools/call", map[string]any{})
			var rpc *rpcError
			if err == nil || errors.As(err, &rpc) != test.rpc {
				t.Fatalf("上游错误分类不符: %v", err)
			}
		})
	}
}
