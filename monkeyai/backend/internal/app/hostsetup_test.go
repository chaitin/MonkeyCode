package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestHostSetupAdminAuthorizationAndIsolation(t *testing.T) {
	db := designAppDatabase(t)
	ctx := t.Context()
	admin, member := resource.ID(), resource.ID()
	for _, entry := range []struct{ id, role string }{{admin, "admin"}, {member, "user"}} {
		if _, err := db.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1::uuid,'test',$1::text || '@example.com',$2)`, entry.id, entry.role); err != nil {
			t.Fatal(err)
		}
	}
	cookie := func(user string) *http.Cookie {
		t.Helper()
		raw := resource.ID()
		hash := sha256.Sum256([]byte(raw))
		if _, err := db.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), user); err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: "monkeyai_session", Value: raw}
	}
	adminCookie, memberCookie := cookie(admin), cookie(member)
	first, second := resource.ID(), resource.ID()
	for _, host := range []string{first, second} {
		if _, err := db.Exec(ctx, `INSERT INTO hosts(id,user_id,name,architecture,version,status) VALUES($1,$2,'host','amd64','v1','active')`, host, admin); err != nil {
			t.Fatal(err)
		}
	}
	identities := identity.NewService(db, nil, "https://server.example")
	service := environment.NewService(db).WithImages(clientEnvironmentImages{})
	router := chi.NewRouter()
	router.Route("/api/admin/v1", func(r chi.Router) { r.Use(identities.RequireAdmin); service.RegisterAdmin(r) })
	call := func(method, host string, cookie *http.Cookie, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api/admin/v1/environment-hosts/"+host+"/setup", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s setup %d，期望%d：%s", method, w.Code, want, w.Body.String())
		}
		return w
	}
	call("GET", first, nil, "", 401)
	call("GET", first, memberCookie, "", 403)
	input := environment.Setup{Resource: environment.Resources{CPUMillis: 1000, MemoryBytes: 1 << 30, HostTasks: 512, TemporaryBytes: 64 << 20}, MaxEnvironments: 100, UserMaxEnvironments: 4}
	grants := []resource.Object{{"user_id": member}}
	input.Grants = &grants
	raw, _ := json.Marshal(input)
	out := call("PUT", first, adminCookie, string(raw), 200)
	var saved environment.SetupView
	if err := json.Unmarshal(out.Body.Bytes(), &saved); err != nil || saved.HostID != first || saved.MaxEnvironments != 100 || len(saved.Grants) != 1 {
		t.Fatalf("宿主授权配置未保存：%v %+v", err, saved)
	}
	allowed, err := resource.Allowed(ctx, db, "host", first, member)
	if err != nil || !allowed {
		t.Fatal("保存范围后成员没有权限", err)
	}
	allowed, err = resource.Allowed(ctx, db, "host", first, admin)
	if err != nil || allowed {
		t.Fatal("管理角色绕过了宿主使用范围", err)
	}
	var other environment.SetupView
	if err := json.Unmarshal(call("GET", second, adminCookie, "", 200).Body.Bytes(), &other); err != nil || other.Resource != nil || other.MaxEnvironments != 0 || len(other.Grants) != 0 {
		t.Fatal("宿主配置污染另一台宿主", err)
	}
	stale := input
	stale.UserMaxEnvironments = 5
	staleRaw, _ := json.Marshal(stale)
	call("PUT", first, adminCookie, string(staleRaw), 200)
	invalid := []resource.Object{{"user_id": "invalid"}}
	input.Grants = &invalid
	raw, _ = json.Marshal(input)
	call("PUT", first, adminCookie, string(raw), 400)
	var audits int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM audits WHERE actor_user_id=$1 AND target_id=$2 AND action='grants'`, admin, first).Scan(&audits); err != nil || audits != 1 {
		t.Fatal("宿主授权缺少审计", audits, err)
	}
}
