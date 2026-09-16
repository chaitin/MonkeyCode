package endpoint

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func rawDial(t *testing.T, f *fixture, headers http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	c, r, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(f.server.URL, "http")+"/endpoints/connect", &websocket.DialOptions{HTTPHeader: headers, CompressionMode: websocket.CompressionDisabled})
	if c != nil {
		t.Cleanup(func() { c.CloseNow() })
	}
	return c, r, err
}
func TestOriginAndHelloRejections(t *testing.T) {
	f := newFixture(t)
	for _, origin := range []string{"null", "https://evil.example.com", "http://localhost/path"} {
		_, r, err := rawDial(t, f, http.Header{"Authorization": []string{"Bearer owner"}, "Origin": []string{origin}})
		if err == nil || r == nil || r.StatusCode != 403 {
			t.Fatalf("来源未拒绝 %s: %v", origin, err)
		}
	}
	c, _, err := rawDial(t, f, http.Header{"Authorization": []string{"Bearer owner"}, "Origin": []string{"http://localhost"}})
	if err != nil {
		t.Fatal(err)
	}
	writeWS(t, c, Message{Type: "event", ID: messageID, Target: machineA, Method: "agent.example", Payload: json.RawMessage(`{}`)})
	readWS(t, c, "error")
	assertClose(t, c, 1002)
	current := dial(t, f, machineA, "owner")
	writeWS(t, current, Hello{Type: "hello", Versions: []int{1}, MachineID: machineA, Profile: Profile{"电脑", "macos", "15", "arm64", "1"}})
	assertClose(t, current, 1002)
}
func TestTokenRotation(t *testing.T) {
	f := newFixture(t)
	old := dial(t, f, machineA, "owner")
	pair, err := f.service.auth.(testAuth).Service.Refresh(t.Context(), "monkeyai-desktop", "owner-refresh")
	if err != nil {
		t.Fatal(err)
	}
	assertClose(t, old, 4003)
	current := dial(t, f, machineA, pair.AccessToken)
	writeWS(t, current, Message{Type: "event", ID: messageID, Target: machineA, Method: "agent.example", Payload: json.RawMessage(`{}`)})
	readWS(t, current, "event")
}
func TestDisabledUserAndStorageFailure(t *testing.T) {
	for _, query := range []string{`UPDATE users SET status='disabled' WHERE id=$1`, `ALTER TABLE oauth_tokens RENAME TO unavailable_tokens`} {
		t.Run(query, func(t *testing.T) {
			f := newFixture(t)
			c := dial(t, f, machineA, "owner")
			code := websocket.StatusCode(1013)
			if strings.HasPrefix(query, "UPDATE") {
				_, err := f.pool.Exec(t.Context(), query, f.user)
				if err != nil {
					t.Fatal(err)
				}
				code = 4003
			} else {
				if _, err := f.pool.Exec(t.Context(), query); err != nil {
					t.Fatal(err)
				}
			}
			assertClose(t, c, code)
		})
	}
}
func TestExpiryAndShutdown(t *testing.T) {
	t.Run("expiry", func(t *testing.T) {
		f := newFixture(t)
		if _, err := f.pool.Exec(t.Context(), `UPDATE oauth_tokens SET access_expires_at=now()+interval '1 second' WHERE user_id=$1`, f.user); err != nil {
			t.Fatal(err)
		}
		c := dial(t, f, machineA, "owner")
		assertClose(t, c, 4003)
	})
	t.Run("shutdown", func(t *testing.T) {
		f := newFixture(t)
		c := dial(t, f, machineA, "owner")
		done := make(chan error, 1)
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			done <- f.service.Shutdown(ctx)
		}()
		assertClose(t, c, 1012)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if f.service.Ready() {
			t.Fatal("停止后仍标为就绪")
		}
		code, _ := call(t, f, "GET", "/endpoints", "", "owner")
		if code != 503 {
			t.Fatal(code)
		}
	})
}
func TestHelloDeadline(t *testing.T) {
	f := newFixture(t)
	f.service.timeHello = 30 * time.Millisecond
	c, _, err := rawDial(t, f, http.Header{"Authorization": []string{"Bearer owner"}})
	if err != nil {
		t.Fatal(err)
	}
	assertClose(t, c, 1002)
}

func TestIdlePing(t *testing.T) {
	f := newFixture(t)
	f.service.pingInterval = 20 * time.Millisecond
	f.service.timePong = 100 * time.Millisecond
	c := dial(t, f, machineA, "owner")
	ctx := c.CloseRead(t.Context())
	time.Sleep(100 * time.Millisecond)
	select {
	case <-ctx.Done():
		t.Fatal("空闲连接未自动响应原生 Ping")
	default:
	}
	code, data := call(t, f, "GET", "/endpoints/"+machineA, "", "owner")
	if code != 200 || !strings.Contains(string(data), `"online":true`) {
		t.Fatalf("心跳后端点离线 %d %s", code, data)
	}
}

func TestMessageLimits(t *testing.T) {
	t.Run("raw", func(t *testing.T) {
		f := newFixture(t)
		c := dial(t, f, machineA, "owner")
		data := strings.Repeat("x", maxMessage+1)
		ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
		defer cancel()
		_ = c.Write(ctx, websocket.MessageText, []byte(data))
		assertClose(t, c, 1009)
	})
	t.Run("normalized", func(t *testing.T) {
		f := newFixture(t)
		c := dial(t, f, machineA, "owner")
		m := Message{Type: "event", ID: messageID, Target: machineA, Method: "agent.example", Payload: json.RawMessage(`{"text":""}`)}
		base, _ := json.Marshal(m)
		m.Payload = json.RawMessage(`{"text":"` + strings.Repeat("x", maxMessage-len(base)-10) + `"}`)
		writeWS(t, c, m)
		got := readWS(t, c, "error")
		if !strings.Contains(string(got["error"]), "payload_too_large") {
			t.Fatalf("注入字段后未检查消息大小: %s", got)
		}
	})
}
