package relay

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func waitMetrics(t *testing.T, s *Service, regular, terminal, candidate int64) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		m := s.Metrics()
		if m["regular_data_streams"] == regular && m["regular_terminal_streams"] == terminal && m["candidate_streams"] == candidate {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("流预算未回收: %+v", m)
		case <-ticker.C:
		}
	}
}

func TestTerminalFullDataTunnelRepeatedReplacement(t *testing.T) {
	f := newFixture(t)
	f.s.config.TerminalWS = true
	runtime := f.runtimeHandler(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != "/cap/held/mcp" {
			return false
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: held\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		return true
	})
	scopes := []string{"session:read", "session:control", "files:read"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	var terminals []*websocket.Conn
	for range 8 {
		ws, _, err := dialTerminal(ctx, f, runtime, connection.Ticket, "")
		if err != nil {
			t.Fatal(err)
		}
		terminals = append(terminals, ws)
	}
	defer func() {
		for _, ws := range terminals {
			ws.CloseNow()
		}
	}()
	var files []io.ReadCloser
	for range 7 {
		r, _ := http.NewRequestWithContext(ctx, "GET", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/cap/held/mcp", nil)
		r.Header.Set("Authorization", "Bearer "+connection.Ticket)
		response, err := http.DefaultClient.Do(r)
		if err != nil || response.StatusCode != 200 {
			t.Fatalf("SSE 占流: %v", err)
		}
		files = append(files, response.Body)
	}
	defer func() {
		for _, body := range files {
			body.Close()
		}
	}()
	waitMetrics(t, f.s, 15, 8, 0)
	if runtime.data.NumStreams() != 15 {
		t.Fatalf("实际数据流=%d", runtime.data.NumStreams())
	}
	_, denied, err := dialTerminal(ctx, f, runtime, connection.Ticket, "")
	if err == nil {
		t.Fatal("普通终端超发")
	}
	assertTerminalError(t, denied, 429, "terminal_limit_reached")
	candidate, _, err := dialTerminal(ctx, f, runtime, connection.Ticket, "?reattach=1")
	if err != nil {
		t.Fatal(err)
	}
	defer candidate.CloseNow()
	waitMetrics(t, f.s, 15, 8, 1)
	if runtime.data.NumStreams() != 16 {
		t.Fatalf("候选未占保留流=%d", runtime.data.NumStreams())
	}
	_, denied, err = dialTerminal(ctx, f, runtime, connection.Ticket, "?reattach=1")
	if err == nil {
		t.Fatal("重复候选超发")
	}
	assertTerminalError(t, denied, 429, "terminal_limit_reached")
	if _, _, err := candidate.Read(ctx); err == nil {
		t.Fatal("未附着候选超时未关闭")
	}
	waitMetrics(t, f.s, 15, 8, 0)
	for range 4 {
		next, _, err := dialTerminal(ctx, f, runtime, connection.Ticket, "?reattach=1")
		if err != nil {
			t.Fatal(err)
		}
		waitMetrics(t, f.s, 15, 8, 1)
		// 测试夹具仅模拟 runtime 释放旧流，不作为 viewId/PTY 业务验收。
		terminals[0].CloseNow()
		terminals[0] = next
		waitMetrics(t, f.s, 15, 8, 0)
		if err := next.Write(ctx, websocket.MessageText, []byte(`{"type":"heartbeat","nonce":"test"}`)); err != nil {
			t.Fatal(err)
		}
		if _, _, err := next.Read(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if f.s.Metrics()["candidate_promotions"] != 4 || f.s.Metrics()["candidate_timeouts"] != 1 {
		t.Fatalf("候选指标异常: %+v", f.s.Metrics())
	}
	for _, ws := range terminals {
		ws.CloseNow()
	}
	for _, body := range files {
		body.Close()
	}
	waitMetrics(t, f.s, 0, 0, 0)
}

func TestTerminalPreUpgradeSecurityAndFreshStateFailure(t *testing.T) {
	f := newFixture(t)
	f.s.config.TerminalWS = true
	runtime := f.runtime(t)
	scopes := []string{"session:read", "session:control"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	base := f.server.URL + "/api/v1/endpoints/" + runtime.hello.MachineID + "/proxy/terminal"
	for _, tc := range []struct {
		name   string
		mutate func(*http.Request)
		status int
		code   string
	}{
		{"恶意Origin", func(r *http.Request) { r.Header.Set("Origin", "https://evil.test") }, 403, "permission_denied"},
		{"未配置开发Origin", func(r *http.Request) { r.Header.Set("Origin", "http://localhost:56123") }, 403, "permission_denied"},
		{"重复Origin", func(r *http.Request) {
			r.Header.Add("Origin", "app://monkeyai")
			r.Header.Add("Origin", "https://evil.test")
		}, 400, "invalid_request"},
		{"未知query", func(r *http.Request) { r.URL.RawQuery = "terminalId=other" }, 400, "invalid_request"},
		{"缺票据且无Origin", func(r *http.Request) { r.Header.Set("Sec-WebSocket-Protocol", terminalProtocol) }, 401, "connection_expired"},
		{"OAuth不是票据", func(r *http.Request) {
			r.Header.Set("Sec-WebSocket-Protocol", terminalProtocol+", monkeyai.token."+f.token)
		}, 401, "connection_expired"},
		{"设备不匹配", func(r *http.Request) {
			r.URL.Path = strings.Replace(r.URL.Path, runtime.hello.MachineID, "10000000-0000-4000-8000-000000000003", 1)
		}, 401, "connection_expired"},
		{"额外业务协议", func(r *http.Request) { r.Header.Add("Sec-WebSocket-Protocol", "monkeyai.v1") }, 400, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := terminalRequest(base)
			r.RequestURI = ""
			r.Header.Set("Sec-WebSocket-Protocol", terminalProtocol+", monkeyai.token."+connection.Ticket)
			tc.mutate(r)
			response, err := http.DefaultClient.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			assertTerminalError(t, response, tc.status, tc.code)
			waitMetrics(t, f.s, 0, 0, 0)
		})
	}
	if _, err := f.pool.Exec(t.Context(), "ALTER TABLE device_client_connections RENAME TO inaccessible_connections"); err != nil {
		t.Fatal(err)
	}
	defer f.pool.Exec(context.Background(), "ALTER TABLE inaccessible_connections RENAME TO device_client_connections")
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	_, response, err := dialTerminal(ctx, f, runtime, connection.Ticket, "?reattach=1")
	if err == nil {
		t.Fatal("权威状态不可用时建立了新终端")
	}
	assertTerminalError(t, response, 503, "authorization_state_unavailable")
	waitMetrics(t, f.s, 0, 0, 0)
}
