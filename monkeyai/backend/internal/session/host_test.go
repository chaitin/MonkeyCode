package session

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestVerifiedHostCannotDowngradeToMachineHeader(t *testing.T) {
	s, ids, user, legacy := sessionDBFixture(t)
	machine, sessionID := resource.ID(), resource.ID()
	var grant string
	scopes := []string{"device:bind", "session:report"}
	if err := s.pool.QueryRow(t.Context(), "INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at) VALUES($1,'monkeyai-desktop',$2,now()+interval '1 day') RETURNING id", user, scopes).Scan(&grant); err != nil {
		t.Fatal(err)
	}
	raw := resource.ID()
	hash := sha256.Sum256([]byte(raw))
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
		VALUES($1,'monkeyai-desktop',$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')`, user, grant, hex.EncodeToString(hash[:]), resource.ID()); err != nil {
		t.Fatal(err)
	}
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	execution := endpoint.NewExecution(s.pool, ids)
	_, err = execution.Enroll(t.Context(), identity.Principal{UserID: user, ClientID: "monkeyai-desktop", GrantID: grant, Scopes: scopes, Audience: identity.Audience, Purpose: "user", RevocationVersion: 1}, endpoint.Enrollment{MachineID: machine, PublicKey: public, DisplayName: "上报宿主", Platform: "macos", Arch: "arm64", Intent: "bind_identity"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	router.Use(ids.RequireAgent)
	s.RegisterAgent(router)
	payload := map[string]any{"state_seq": 0, "session_type": "conversation", "started_at": time.Now().UTC(), "client": map[string]any{"type": "desktop", "machine_id": machine, "version": "1"}}
	body, _ := json.Marshal(payload)
	call := func(token, header string, want int) {
		t.Helper()
		req := httptest.NewRequest("PUT", "/sessions/"+sessionID, strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+token)
		if header != "" {
			req.Header.Set("X-MAI-Machine-ID", header)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("宿主状态=%d want=%d body=%s", response.Code, want, response.Body.String())
		}
		if want == http.StatusForbidden && !strings.Contains(response.Body.String(), "device_identity_required") {
			t.Fatalf("降级错误码异常：%s", response.Body.String())
		}
	}
	call(raw, "", 200)
	call(legacy, machine, 403)
	call(raw, resource.ID(), 409)
	if _, err := s.pool.Exec(t.Context(), "UPDATE endpoints SET remote_access_state='revoked',grant_version=grant_version+1 WHERE user_id=$1 AND machine_id=$2", user, machine); err != nil {
		t.Fatal(err)
	}
	call(raw, machine, 200)
	var verified bool
	if err := s.pool.QueryRow(t.Context(), "SELECT host_verified FROM sessions WHERE id=$1", sessionID).Scan(&verified); err != nil || !verified {
		t.Fatalf("会话未保存认证宿主：%v", err)
	}
}
