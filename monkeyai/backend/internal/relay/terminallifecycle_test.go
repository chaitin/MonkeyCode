package relay

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestTerminalSocketSurvivesOriginalTicketAndHandshakeDeadline(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:control"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	if _, err := f.pool.Exec(t.Context(), "UPDATE device_client_connections SET expires_at=now()+interval '2 seconds' WHERE id=$1", connection.ConnectionID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 14*time.Second)
	defer cancel()
	ws, _, err := dialTerminal(ctx, f, runtime, connection.Ticket, "")
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: connection.ConnectionID}, f.token)
	timer := time.NewTimer(9 * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if err := ws.Write(ctx, websocket.MessageText, []byte(`{"type":"heartbeat","nonce":"alive"}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ws.Read(ctx); err != nil {
		t.Fatalf("正常续票或握手总期限关闭已有 socket: %v", err)
	}
}

func TestTerminalRevocationAndTunnelLossReleaseStreams(t *testing.T) {
	for _, event := range []string{"grant", "device", "control", "events", "data", "shutdown"} {
		t.Run(event, func(t *testing.T) {
			f := newFixture(t)
			runtime := f.runtime(t)
			token, grant := f.mint(t, f.user, []string{"device:connect", "session:control"})
			scopes := []string{"session:control"}
			connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, token)
			ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
			defer cancel()
			ws, _, err := dialTerminal(ctx, f, runtime, connection.Ticket, "")
			if err != nil {
				t.Fatal(err)
			}
			defer ws.CloseNow()
			switch event {
			case "grant":
				if err := f.ids.RevokeGrant(ctx, grant, "terminal_test"); err != nil {
					t.Fatal(err)
				}
			case "device":
				r, _ := http.NewRequestWithContext(ctx, "DELETE", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID, nil)
				r.Header.Set("Authorization", "Bearer "+f.token)
				r.Header.Set("If-Match", "1")
				response, err := http.DefaultClient.Do(r)
				if err != nil {
					t.Fatal(err)
				}
				response.Body.Close()
				if response.StatusCode != 204 {
					t.Fatal(response.StatusCode)
				}
			case "control":
				runtime.mux.Close()
			case "events":
				runtime.control.Close()
			case "data":
				runtime.data.Close()
			case "shutdown":
				if err := f.s.Shutdown(ctx); err != nil {
					t.Fatal(err)
				}
			}
			if _, _, err := ws.Read(ctx); err == nil {
				t.Fatalf("%s 未关闭终端", event)
			}
			waitMetrics(t, f.s, 0, 0, 0)
			if (event == "grant" || event == "data") && f.s.current(target{f.user, runtime.hello.MachineID}) == nil {
				t.Fatal("局部失效破坏设备控制路由")
			}
		})
	}
}
