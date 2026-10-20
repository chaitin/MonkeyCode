package relay

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
)

func terminalRequest(target string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, target, nil)
	r.Header.Set("Connection", "keep-alive, Upgrade")
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("Sec-WebSocket-Version", "13")
	r.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	r.Header.Set("Sec-WebSocket-Protocol", terminalProtocol+", monkeyai.token.test-ticket")
	return r
}

func TestTerminalHandshakeBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name      string
		mutate    func(*http.Request)
		valid     bool
		candidate bool
	}{
		{"普通", func(r *http.Request) {}, true, false},
		{"候选", func(r *http.Request) { r.URL.RawQuery = "reattach=1" }, true, true},
		{"解码候选", func(r *http.Request) { r.URL.RawQuery = "reattach=%31" }, true, true},
		{"相同双来源", func(r *http.Request) { r.Header.Set("Authorization", "Bearer test-ticket") }, true, false},
		{"原生", func(r *http.Request) {
			r.Header.Set("Authorization", "Bearer test-ticket")
			r.Header.Set("Sec-WebSocket-Protocol", terminalProtocol)
		}, true, false},
		{"不一致双来源", func(r *http.Request) { r.Header.Set("Authorization", "Bearer other") }, false, false},
		{"重复Authorization", func(r *http.Request) {
			r.Header["Authorization"] = []string{"Bearer test-ticket", "Bearer test-ticket"}
		}, false, false},
		{"重复票据", func(r *http.Request) { r.Header.Add("Sec-WebSocket-Protocol", "monkeyai.token.test-ticket") }, false, false},
		{"重复业务", func(r *http.Request) { r.Header.Add("Sec-WebSocket-Protocol", terminalProtocol) }, false, false},
		{"额外业务", func(r *http.Request) { r.Header.Add("Sec-WebSocket-Protocol", "monkeyai.v1") }, false, false},
		{"缺业务", func(r *http.Request) { r.Header.Set("Sec-WebSocket-Protocol", "monkeyai.token.test-ticket") }, false, false},
		{"空票据", func(r *http.Request) { r.Header.Set("Sec-WebSocket-Protocol", terminalProtocol+", monkeyai.token.") }, false, false},
		{"重复Origin", func(r *http.Request) { r.Header["Origin"] = []string{"app://monkeyai", "https://evil.test"} }, false, false},
		{"非GET", func(r *http.Request) { r.Method = "POST" }, false, false},
		{"缺Upgrade", func(r *http.Request) { r.Header.Del("Upgrade") }, false, false},
		{"缺Connection", func(r *http.Request) { r.Header.Del("Connection") }, false, false},
		{"无效Key", func(r *http.Request) { r.Header.Set("Sec-WebSocket-Key", "bad") }, false, false},
		{"重复Key", func(r *http.Request) { r.Header.Add("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==") }, false, false},
		{"重复Version", func(r *http.Request) { r.Header.Add("Sec-WebSocket-Version", "13") }, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := terminalRequest("http://relay.test/terminal")
			tc.mutate(r)
			_, candidate, valid := terminalHandshake(r)
			if valid != tc.valid || candidate != tc.candidate {
				t.Fatalf("握手: valid=%v candidate=%v", valid, candidate)
			}
		})
	}
	for _, query := range []string{"token=x", "sessionId=x", "terminalId=x", "owner=x", "reattach=0", "reattach=1&reattach=1", "reattach=1&x=1", "reattach=%zz", "reattach=1;token=x", "&", "reattach=1&"} {
		r := terminalRequest("http://relay.test/terminal")
		r.URL.RawQuery = query
		if _, _, valid := terminalHandshake(r); valid {
			t.Fatalf("接受非法查询 %q", query)
		}
	}
}

func TestTerminalUpgradeValidation(t *testing.T) {
	key := "dGhlIHNhbXBsZSBub25jZQ=="
	hash := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	for _, change := range []string{"", "protocol", "empty", "token", "accept", "compression", "connection"} {
		response := &http.Response{Header: http.Header{}}
		response.Header.Set("Connection", "Upgrade")
		response.Header.Set("Upgrade", "websocket")
		response.Header.Set("Sec-WebSocket-Protocol", terminalProtocol)
		response.Header.Set("Sec-WebSocket-Accept", base64.StdEncoding.EncodeToString(hash[:]))
		switch change {
		case "protocol":
			response.Header.Set("Sec-WebSocket-Protocol", "monkeyai.v1")
		case "empty":
			response.Header.Del("Sec-WebSocket-Protocol")
		case "token":
			response.Header.Set("Sec-WebSocket-Protocol", "monkeyai.token.test-ticket")
		case "accept":
			response.Header.Set("Sec-WebSocket-Accept", "bad")
		case "compression":
			response.Header.Set("Sec-WebSocket-Extensions", "permessage-deflate")
		case "connection":
			response.Header.Del("Connection")
		}
		if validTerminalUpgrade(response, key) != (change == "") {
			t.Fatalf("上游升级校验: %s", change)
		}
	}
}

func TestTerminalPathAndDisabledCapability(t *testing.T) {
	s := &Service{logger: slog.New(slog.NewTextHandler(io.Discard, nil)), config: Config{TerminalWS: true}}
	router := chi.NewRouter()
	router.HandleFunc("/api/v1/endpoints/{machine}/proxy/*", s.proxy)
	base := "http://relay.test/api/v1/endpoints/10000000-0000-4000-8000-000000000003/proxy"
	for _, path := range []string{"/terminal/../acp", "/terminal%2facp", "/terminal%5cacp", "/terminal//acp", "/%2e%2e/terminal"} {
		r := terminalRequest(base + path)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("路径 %s status=%d", path, w.Code)
		}
	}
	s.config.TerminalWS = false
	w := httptest.NewRecorder()
	router.ServeHTTP(w, terminalRequest(base+"/terminal"))
	if w.Code != 404 || !strings.Contains(w.Body.String(), `"not_found"`) {
		t.Fatal("能力关闭仍提供终端")
	}
	features := s.Metadata()["features"].(map[string]bool)
	if features["terminal_ws"] {
		t.Fatal("默认开启能力")
	}
	s.config.TerminalWS = true
	if !s.Metadata()["features"].(map[string]bool)["terminal_ws"] {
		t.Fatal("能力开关未发布")
	}
}

func terminalURL(f *fixture, runtime *runtimeFixture) string {
	return strings.Replace(f.server.URL, "http", "ws", 1) + "/api/v1/endpoints/" + runtime.hello.MachineID + "/proxy/terminal"
}

func dialTerminal(ctx context.Context, f *fixture, runtime *runtimeFixture, ticket, query string) (*websocket.Conn, *http.Response, error) {
	return websocket.Dial(ctx, terminalURL(f, runtime)+query, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"app://monkeyai"}}, Subprotocols: []string{terminalProtocol, "monkeyai.token." + ticket}})
}

func TestTerminalProxyFreshLeaseHeadersRotationAndNarrowing(t *testing.T) {
	f := newFixture(t)
	f.s.config.TerminalWS = true
	proxy := httptest.NewServer(logging.HTTP(f.s.logger)(f.server.Config.Handler))
	t.Cleanup(proxy.Close)
	f.server = proxy
	seen := make(chan *http.Request, 1)
	runtime := f.runtimeHandler(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/terminal" {
			w.Header().Set("X-Request-ID", "forged-runtime")
			select {
			case seen <- r.Clone(context.Background()):
			default:
			}
		}
		return false
	})
	scopes := []string{"session:read", "session:control"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	headers := http.Header{"X-Request-ID": {"forged-client"}, "Origin": {"app://monkeyai"}, "Cookie": {"secret=private"}, "Authorization": {"Bearer " + connection.Ticket}, "X-MonkeyAI-Access": {"forged", "forged-again"}, "X-MonkeyAI-Owner": {"forged"}, "X-MAI-Role": {"host"}}
	ws, response, err := websocket.Dial(ctx, terminalURL(f, runtime), &websocket.DialOptions{HTTPHeader: headers, Subprotocols: []string{terminalProtocol, "monkeyai.token." + connection.Ticket}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if ws.Subprotocol() != terminalProtocol || response.Header.Get("Cache-Control") != "no-store" || response.Header.Get("Set-Cookie") != "" {
		t.Fatal("响应握手头错误")
	}
	if id := response.Header.Get("X-Request-ID"); len(id) != 32 || id == "forged-client" || id == "forged-runtime" {
		t.Fatalf("终端响应丢失或采用外部请求关联 ID: %q", id)
	}
	request := <-seen
	if request.Host != "device.internal" || request.URL.Path != "/terminal" || request.URL.RawQuery != "" || request.Header.Get("Sec-WebSocket-Protocol") != terminalProtocol || len(request.Header.Values("X-MonkeyAI-Access")) != 1 || request.Header.Get("X-MonkeyAI-Owner") != "" {
		t.Fatal("上游头或路由错误")
	}
	echo := func() {
		t.Helper()
		payload := []byte(`{"type":"output","seq":1,"data":"5Lit5paH8J+YgA=="}`)
		if err := ws.Write(ctx, websocket.MessageText, payload); err != nil {
			t.Fatal(err)
		}
		kind, out, err := ws.Read(ctx)
		if err != nil || kind != websocket.MessageText || string(out) != string(payload) {
			t.Fatalf("未透明转发: %s %v", out, err)
		}
	}
	echo()
	rotated := f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: connection.ConnectionID}, f.token)
	if rotated.ConnectionID != connection.ConnectionID || rotated.TicketVersion != 2 {
		t.Fatal("续票逻辑连接改变")
	}
	echo()
	narrow := []string{"session:read"}
	restricted := f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: connection.ConnectionID, Scopes: &narrow}, f.token)
	if _, _, err := ws.Read(ctx); err == nil {
		t.Fatal("收窄未关闭终端")
	}
	_, denied, err := dialTerminal(ctx, f, runtime, restricted.Ticket, "")
	if err == nil || denied.StatusCode != 403 {
		t.Fatal("只读票据允许终端")
	}
	_, denied, err = dialTerminal(ctx, f, runtime, rotated.Ticket, "")
	if err == nil || denied.StatusCode != 401 {
		t.Fatal("权限收窄后旧票据仍有效")
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) == nil {
		t.Fatal("关闭终端破坏设备路由")
	}
}

func TestTerminalUpstreamFailurePassthroughAndOffline(t *testing.T) {
	f := newFixture(t)
	f.s.config.TerminalWS = true
	runtime := f.runtimeHandler(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != "/terminal" {
			return false
		}
		w.Header().Set("Set-Cookie", "private=secret")
		http.Error(w, "invalid_terminal_attachment", 400)
		return true
	})
	scopes := []string{"session:control"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	_, response, err := dialTerminal(ctx, f, runtime, connection.Ticket, "")
	if err == nil || response.StatusCode != 400 || response.Header.Get("Content-Type") != "text/plain; charset=utf-8" || response.Header.Get("Set-Cookie") != "" {
		t.Fatalf("未保留上游错误: %v %+v", err, response)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if string(body) != "invalid_terminal_attachment\n" {
		t.Fatalf("错误正文被改写: %s", body)
	}
	runtime.data.Close()
	_, response, err = dialTerminal(ctx, f, runtime, connection.Ticket, "")
	if err == nil || response.StatusCode != 503 {
		t.Fatal("数据离线没有拒绝")
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) == nil {
		t.Fatal("数据断开破坏控制路由")
	}
}

func TestTerminalLateLeaseRevocationDoesNotCloseNewAccess(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:read", "session:control"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	narrow := []string{"session:read"}
	f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: connection.ConnectionID, Scopes: &narrow}, f.token)
	route := f.s.current(target{f.user, runtime.hello.MachineID})
	a := &access{id: connection.ConnectionID, accessVersion: 2}
	f.s.mu.Lock()
	route.streams[a] = struct{}{}
	f.s.mu.Unlock()
	request := LeaseRequest{Type: "access_lease_request", Authorization: FileAuthorization{ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: runtime.hello.MachineID, ConnectionID: connection.ConnectionID, ClientGrantID: f.grant, GrantVersion: runtime.ready.GrantVersion, AccessVersion: 1, LeaseEpoch: runtime.ready.LeaseEpoch, Scopes: connection.Scopes}, Nonce: "late", LeaseSeq: 1, BootID: runtime.hello.BootID}
	result, status := f.s.lease(t.Context(), route, request)
	if status != 200 || result.Revocation == "" {
		t.Fatalf("旧授权未撤销: %+v", result)
	}
	a.mu.Lock()
	closed := a.closed
	a.mu.Unlock()
	if closed {
		t.Fatal("迟到旧租约关闭新权限版本")
	}
}

func assertTerminalError(t *testing.T, response *http.Response, status int, code string) {
	t.Helper()
	defer response.Body.Close()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil || response.StatusCode != status || body.Error.Code != code {
		t.Fatalf("错误响应: status=%d body=%+v err=%v", response.StatusCode, body, err)
	}
}
