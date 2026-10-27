package audit

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func TestWriteRequest(t *testing.T) {
	s, actor := fixture(t)
	for _, tc := range []struct {
		name   string
		actor  Actor
		attach bool
		want   bool
	}{
		{"完整身份", actor, true, true},
		{"仅用户ID", Actor{ID: actor.ID}, true, true},
		{"身份不匹配", Actor{ID: "22222222-2222-4222-8222-222222222222"}, true, false},
		{"无请求上下文", actor, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.pool.Exec(t.Context(), "DELETE FROM audits"); err != nil {
				t.Fatal(err)
			}
			handler := logging.HTTP(s.logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				ctx := r.Context()
				if tc.attach {
					ctx = WithRequest(r, tc.actor)
				}
				if err := Write(ctx, s.pool, Event{ActorID: actor.ID, Action: "endpoint.bind_identity", Category: "security"}); err != nil {
					t.Fatal(err)
				}
			}))
			r := httptest.NewRequest(http.MethodGet, "/api/v1/endpoint-bridge", nil)
			r.RemoteAddr = "172.18.0.5:1234"
			r.Header.Set("X-Real-IP", "198.51.100.23")
			r.Header.Set("User-Agent", "audit-device")
			r.Header.Set("X-Request-ID", "forged-request")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			var name, email, ip, agent, id string
			err := s.pool.QueryRow(t.Context(), `SELECT actor_name, actor_email, COALESCE(host(source_ip),''), COALESCE(user_agent,''), COALESCE(request_id,'') FROM audits`).Scan(&name, &email, &ip, &agent, &id)
			if err != nil {
				t.Fatal(err)
			}
			if name != actor.Name || email != actor.Email {
				t.Fatalf("操作人信息丢失: %q %q", name, email)
			}
			if tc.want {
				if ip != "198.51.100.23" || agent != "audit-device" || id == "" || id == "forged-request" || id != w.Header().Get("X-Request-ID") {
					t.Fatalf("请求信息错误: ip=%q agent=%q id=%q", ip, agent, id)
				}
			} else if ip != "" || agent != "" || id != "" {
				t.Fatalf("独立事件不应继承其他操作人的请求信息: ip=%q agent=%q id=%q", ip, agent, id)
			}
		})
	}
}
