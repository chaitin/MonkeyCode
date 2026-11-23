package app

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/go-chi/chi/v5"
)

type testLicenseStatus struct{}

func (testLicenseStatus) RegisterAdmin(r chi.Router) {
	r.Get("/private-extension-status", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
}

func (testLicenseStatus) RegisterSharedAdminReads(get func(string, http.HandlerFunc)) {
	get("/license/status", func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, `{"state":"valid"}`) })
}

func TestSupervisorSharedReads(t *testing.T) {
	pool := designAppDatabase(t)
	ctx := t.Context()
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	t.Cleanup(storage.Close)
	t.Setenv("MONKEYAI_S3_ENDPOINT", storage.URL)
	t.Setenv("MONKEYAI_S3_ACCESS_KEY", "test")
	t.Setenv("MONKEYAI_S3_SECRET_KEY", "test-only-secret")
	makeHandler := func(registrars ...AdminRegistrar) http.Handler {
		t.Helper()
		h, err := newApplicationHandlerWithMembers(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost"}, nil, nil, registrars)
		if err != nil {
			t.Fatal(err)
		}
		return h
	}
	account := func(name, role string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, "INSERT INTO users(name,email,role) VALUES($1,$2,$3) RETURNING id", name, name+"@example.test", role).Scan(&id); err != nil {
			t.Fatal(err)
		}
		_, err := pool.Exec(ctx, "INSERT INTO browser_sessions(user_id,token_hash,authentication_method,expires_at) VALUES($1,$2,'password', now()+interval '1 hour')", id, fmt.Sprintf("%x", sha256.Sum256([]byte(name))))
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	admin := account("admin", "admin")
	lead := account("lead", "user")
	outsider := account("outsider", "user")
	for name, uid := range map[string]string{"managed": lead, "other": outsider} {
		_, err := pool.Exec(ctx, `WITH g AS (INSERT INTO groups(name) VALUES($1) RETURNING id) INSERT INTO group_users(group_id,user_id,assigned_by_user_id,is_supervisor) SELECT id,$2,$3,true FROM g`, name, uid, admin)
		if err != nil {
			t.Fatal(err)
		}
	}
	account("ordinary", "user")
	h := makeHandler(testLicenseStatus{})
	get := func(method, path, who string, status int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, "/api/admin/v1"+path, nil)
		if who != "" {
			req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: who})
		}
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s %s: got %d want %d: %s", who, method, path, res.Code, status, res.Body.String())
		}
		return res.Body.Bytes()
	}
	for _, p := range []string{"/users", "/groups", "/license/status"} {
		want := get("GET", p, "admin", 200)
		got := get("GET", p, "lead", 200)
		if !bytes.Equal(got, want) {
			t.Fatalf("主管和超管响应不一致: %s", p)
		}
		if p != "/license/status" && !strings.Contains(string(got), outsider) {
			t.Fatalf("缺少非受管组成员: %s", p)
		}
		get("GET", p, "ordinary", 403)
		get("GET", p, "", 401)
		get("POST", p, "lead", 403)
		get("HEAD", p, "lead", 403)
	}
	for _, test := range [][2]string{{"GET", "/users/" + outsider}, {"GET", "/groups/"}, {"GET", "/me"}, {"PATCH", "/users/" + outsider}, {"DELETE", "/groups/test"}, {"PUT", "/groups/test/supervisors"}, {"POST", "/license/import"}, {"POST", "/license/downgrade"}} {
		get(test[0], test[1], "lead", 403)
	}
	t.Run("成员搜索", func(t *testing.T) { testAdminUserCandidates(t, pool, h) })
	get("GET", "/billing/users?q=", "admin", 404)
	get("GET", "/private-extension-status", "admin", 204)
	get("GET", "/private-extension-status", "lead", 403)
	h = makeHandler()
	get("GET", "/license/status", "admin", 404)
	get("GET", "/license/status", "lead", 404)
	if _, err := pool.Exec(ctx, "UPDATE group_users SET is_supervisor=false WHERE user_id=$1", lead); err != nil {
		t.Fatal(err)
	}
	get("GET", "/users", "lead", 403)
}
