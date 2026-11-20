package environment

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestAdminRuntimeUpgrade(t *testing.T) {
	s, created, host, _ := managedEnvironment(t)
	s.WithRuntimeCatalog(runtimeCatalogFixture{latest: "26.1105.2"})
	ctx := t.Context()
	env := created.Environment
	admin := resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'admin','runtime-admin@example.test','admin')`, admin); err != nil {
		t.Fatal(err)
	}
	cookie := func(id string) *http.Cookie {
		t.Helper()
		token := resource.ID()
		if _, err := s.pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, fmt.Sprintf("%x", sha256.Sum256([]byte(token))), id); err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: "monkeyai_session", Value: token}
	}
	if _, err := s.pool.Exec(ctx, `UPDATE hosts SET report=report || '{"environment_protocol":2,"runtime_update_protocol":1}'::jsonb WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Use(identity.NewService(s.pool, nil, "https://server.example").RequireAdmin)
	s.RegisterAdmin(r)
	call := func(method string, c *http.Cookie, body string, want int) []byte {
		t.Helper()
		path := "/environments/" + env.ID + "/runtime"
		if method == "POST" {
			path += "/upgrade"
		}
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if c != nil {
			req.AddCookie(c)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d，期望 %d：%s", method, path, w.Code, want, w.Body.String())
		}
		return w.Body.Bytes()
	}
	memberCookie, adminCookie := cookie(env.UserID), cookie(admin)
	for _, method := range []string{"GET", "POST"} {
		call(method, nil, "", 401)
		call(method, memberCookie, "", 403)
	}
	call("POST", adminCookie, `{"generation":1,"request_key":"running"}`, 409)
	stopped, err := s.Change(ctx, &env.UserID, env.ID, "stopped", Change{Generation: 1, RequestKey: "stop"})
	if err != nil {
		t.Fatal(err)
	}
	obs := observe(stopped.Environment, "stopped")
	obs.RuntimeVersion = "26.1105.1"
	syncState(t, s, host, obs)
	var info RuntimeInfo
	if err := json.Unmarshal(call("GET", adminCookie, "", 200), &info); err != nil || !info.CanUpdate || !info.UpdateAvailable {
		t.Fatal(info, err)
	}
	input := `{"generation":2,"version":"26.1105.2","request_key":"admin-upgrade"}`
	var first, retry Result
	if err := json.Unmarshal(call("POST", adminCookie, input, 202), &first); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(call("POST", adminCookie, input, 202), &retry); err != nil || retry.Operation.ID != first.Operation.ID || first.Operation.Kind != "runtime_upgrade" || first.Environment.Desired != "stopped" {
		t.Fatal(first, retry, err)
	}
	obs.Generation, obs.RuntimeVersion = first.Environment.Generation, "26.1105.2"
	syncState(t, s, host, obs)
	if err := json.Unmarshal(call("GET", adminCookie, "", 200), &info); err != nil || info.CurrentVersion != obs.RuntimeVersion || info.Operation == nil || info.Operation.Status != "succeeded" {
		t.Fatal(info, err)
	}
}
