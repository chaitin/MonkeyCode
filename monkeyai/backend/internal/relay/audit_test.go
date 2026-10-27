package relay

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/coder/websocket"
)

func TestBridgeAudit(t *testing.T) {
	for _, tc := range []struct {
		name, intent, peer, realIP, wantIP string
	}{
		{"直连绑定", "bind_identity", "198.51.100.10:1234", "203.0.113.99", "198.51.100.10"},
		{"代理绑定", "bind_identity", "172.18.0.5:1234", "198.51.100.23", "198.51.100.23"},
		{"IPv6绑定", "bind_identity", "[fd00::5]:1234", "2001:db8::23", "2001:db8::23"},
		{"代理发布", "publish", "172.18.0.5:1234", "198.51.100.23", "198.51.100.23"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			server := httptest.NewServer(logging.HTTP(f.s.logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				r.RemoteAddr = tc.peer
				f.server.Config.Handler.ServeHTTP(w, r)
			})))
			defer server.Close()
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			ws, response, err := websocket.Dial(ctx, strings.Replace(server.URL, "http", "ws", 1)+"/api/v1/endpoint-bridge?channel_kind=control&tunnel_version=1", &websocket.DialOptions{HTTPHeader: http.Header{
				"Authorization": {"Bearer " + f.token}, "User-Agent": {"audit-desktop"},
				"X-Real-IP": {tc.realIP}, "X-Request-ID": {"forged-request"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			defer ws.CloseNow()
			public, private, err := ed25519.GenerateKey(nil)
			if err != nil {
				t.Fatal(err)
			}
			hello := Hello{Type: "hello", TunnelVersion: Version, ChannelKind: "control", MachineID: uuid.New().String(), BootID: uuid.New().String(), ExecutionPublicKey: base64.RawURLEncoding.EncodeToString(public), DisplayName: "审计设备", Platform: "macos", Arch: "arm64", DeploymentMode: "desktop_managed", Intent: tc.intent, Protocols: map[string][]int{"acp": {1}, "runtime_api": {1}}}
			if err := writeWS(ctx, ws, hello); err != nil {
				t.Fatal(err)
			}
			var challenge Challenge
			if err := readWS(ctx, ws, &challenge); err != nil {
				t.Fatal(err)
			}
			message, err := ProofBytes(hello, challenge)
			if err != nil {
				t.Fatal(err)
			}
			if err := writeWS(ctx, ws, Proof{Type: "proof", ChallengeID: challenge.ChallengeID, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, message))}); err != nil {
				t.Fatal(err)
			}
			var ready Ready
			if err := readWS(ctx, ws, &ready); err != nil || !ready.Bound {
				t.Fatalf("绑定失败: %+v %v", ready, err)
			}
			if err := writeWS(ctx, ws, ReadyAck{Type: "ready_ack", RegistrationVersion: ready.RegistrationVersion, LeaseEpoch: ready.LeaseEpoch}); err != nil {
				t.Fatal(err)
			}
			var action, name, email, ip, agent, id string
			err = f.pool.QueryRow(ctx, `SELECT action, actor_name, actor_email, COALESCE(host(source_ip),''), COALESCE(user_agent,''), COALESCE(request_id,'') FROM audits WHERE actor_user_id=$1`, f.user).Scan(&action, &name, &email, &ip, &agent, &id)
			if err != nil {
				t.Fatal(err)
			}
			if action != "endpoint."+tc.intent || name != "中转测试" || email != f.user+"@example.com" || ip != tc.wantIP || agent != "audit-desktop" || id == "" || id == "forged-request" || id != response.Header.Get("X-Request-ID") {
				t.Fatalf("审计信息不完整: action=%q name=%q email=%q ip=%q agent=%q id=%q", action, name, email, ip, agent, id)
			}
			var count int
			if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM audits").Scan(&count); err != nil || count != 1 {
				t.Fatalf("业务审计重复或丢失: count=%d err=%v", count, err)
			}
		})
	}
}
