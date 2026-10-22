package session

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestSessionClientType(t *testing.T) {
	for _, clientType := range []string{"desktop", "web", "extension", "mobile", "runtime", "unknown", "", "headless", "Runtime"} {
		t.Run(clientType, func(t *testing.T) {
			in := sessionInput{
				StateSeq: new(int64(1)), SessionType: stringPtr("conversation"),
				StartedAt: &timeValue{Time: time.Now()},
				Client:    &clientInput{Type: clientType, MachineID: resource.ID(), Version: "1"},
			}
			err := validateSessionInput(in)
			invalid := clientType == "" || clientType == "headless" || clientType == "Runtime"
			if invalid {
				if code(err) != "invalid_state" {
					t.Fatalf("无效类型未拒绝: %v", err)
				}
			} else if err != nil {
				t.Fatalf("客户端类型应被接受: %v", err)
			}
		})
	}
}

func TestRuntimeSessionReporting(t *testing.T) {
	s, identities, user, token := sessionDBFixture(t)
	id, machine := resource.ID(), resource.ID()
	router := chi.NewRouter()
	router.Use(identities.RequireAgent)
	s.RegisterAgent(router)
	body, err := json.Marshal(resource.Object{
		"state_seq": 1, "session_type": "conversation", "started_at": time.Now().UTC(),
		"client": resource.Object{"type": "runtime", "machine_id": machine, "version": "1", "runtime_version": "2"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		req := httptest.NewRequest(http.MethodPut, "/sessions/"+id, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-MAI-Machine-ID", machine)
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != http.StatusOK {
			t.Fatalf("runtime 上报失败: HTTP %d: %s", response.Code, response.Body.String())
		}
	}
	var clientType, clientName, owner, host, version string
	var placeholder bool
	if err := s.pool.QueryRow(t.Context(), `SELECT client_type,client_name,owner_user_id::text,device_id,runtime_version,placeholder FROM sessions WHERE id=$1`, id).
		Scan(&clientType, &clientName, &owner, &host, &version, &placeholder); err != nil {
		t.Fatal(err)
	}
	if clientType != "runtime" || clientName != "runtime" || owner != user || host != machine || version != "2" || placeholder {
		t.Fatalf("runtime 会话未正确持久化: type=%s name=%s owner=%s host=%s version=%s placeholder=%v", clientType, clientName, owner, host, version, placeholder)
	}
}
