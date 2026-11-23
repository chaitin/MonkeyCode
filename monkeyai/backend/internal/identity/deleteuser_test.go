package identity

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAdminDeleteUser(t *testing.T) {
	pool := emailDatabase(t)
	ctx := t.Context()
	var adminID, memberID string
	for _, user := range []struct {
		id   *string
		role string
	}{{&adminID, "admin"}, {&memberID, "user"}} {
		if err := pool.QueryRow(ctx, "INSERT INTO users(name,email,role,password_hash) VALUES($1, $1 || '@example.com', $1, 'old') RETURNING id", user.role).Scan(user.id); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')", tokenHash(user.role), *user.id); err != nil {
			t.Fatal(err)
		}
	}
	for _, query := range []string{
		"WITH g AS (INSERT INTO groups(name) VALUES('测试组') RETURNING id) INSERT INTO group_users(group_id,user_id,assigned_by_user_id,is_supervisor) SELECT id,$1,$1,true FROM g",
		"INSERT INTO user_identities(user_id,provider,issuer,provider_subject) VALUES($1,'oidc','issuer','subject')",
		"WITH g AS (INSERT INTO oauth_grants(user_id,client_id,expires_at) VALUES($1,'monkeyai-desktop',now()+interval '1 day') RETURNING id) INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at,grant_id) SELECT $1,'monkeyai-desktop','access','refresh',now()+interval '1 hour',now()+interval '1 day',id FROM g",
		"WITH r AS (INSERT INTO oauth_authorization_requests(client_id,redirect_uri,state,code_challenge,code_challenge_method,expires_at) VALUES('monkeyai-desktop','http://localhost','state','challenge','S256',now()+interval '1 hour') RETURNING id) INSERT INTO oauth_authorization_codes(code_hash,authorization_request_id,user_id,client_id,redirect_uri,code_challenge,expires_at) SELECT 'code',id,$1,'monkeyai-desktop','http://localhost','challenge',now()+interval '1 hour' FROM r",
		"INSERT INTO email_codes(email,purpose,code_hash,expires_at) SELECT u.email,p.purpose,'code',now()+interval '1 hour' FROM users u CROSS JOIN (VALUES ('login'),('reset')) p(purpose) WHERE u.id=$1",
	} {
		if _, err := pool.Exec(ctx, query, memberID); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(pool, nil, "")
	router := chi.NewRouter()
	router.Use(service.RequireAdmin)
	service.RegisterAdmin(router)
	call := func(method, path, session string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, nil)
		if session != "" {
			req.AddCookie(&http.Cookie{Name: sessionCookie, Value: session})
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s %s: 状态码=%d，期望=%d，响应=%s", method, path, rec.Code, want, rec.Body)
		}
		return rec
	}
	path := "/users/" + memberID
	call("DELETE", path, "", http.StatusUnauthorized)
	call("DELETE", path, "user", http.StatusForbidden)
	call("DELETE", "/users/"+strings.ToUpper(adminID), "admin", http.StatusConflict)
	call("DELETE", "/users/invalid", "admin", http.StatusBadRequest)

	if _, err := pool.Exec(ctx, `
		CREATE FUNCTION reject_session_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'test revocation failure'; END $$;
		CREATE TRIGGER reject_session_revocation BEFORE UPDATE ON browser_sessions
		FOR EACH ROW EXECUTE FUNCTION reject_session_revocation();`); err != nil {
		t.Fatal(err)
	}
	call("DELETE", path, "admin", http.StatusInternalServerError)
	call("GET", path, "admin", http.StatusOK)
	if _, err := pool.Exec(ctx, "DROP TRIGGER reject_session_revocation ON browser_sessions"); err != nil {
		t.Fatal(err)
	}

	call("DELETE", path, "admin", http.StatusNoContent)
	call("DELETE", path, "admin", http.StatusNotFound)
	call("GET", path, "admin", http.StatusNotFound)
	call("GET", "/me", "user", http.StatusUnauthorized)
	if rec := call("GET", "/users", "admin", http.StatusOK); strings.Contains(rec.Body.String(), memberID) {
		t.Fatalf("成员仍出现在列表中: %s", rec.Body)
	}
	for _, query := range []string{
		"SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NOT NULL AND password_hash IS NULL)",
		"SELECT EXISTS(SELECT 1 FROM group_users WHERE user_id=$1 AND removed_at IS NOT NULL AND is_supervisor)",
		"SELECT EXISTS(SELECT 1 FROM user_identities WHERE user_id=$1 AND deleted_at IS NOT NULL)",
		"SELECT EXISTS(SELECT 1 FROM oauth_grants WHERE user_id=$1 AND revoked_at IS NOT NULL)",
		"SELECT EXISTS(SELECT 1 FROM oauth_tokens WHERE user_id=$1 AND revoked_at IS NOT NULL)",
		"SELECT EXISTS(SELECT 1 FROM oauth_authorization_codes WHERE user_id=$1 AND redeemed_at IS NOT NULL)",
		"SELECT NOT EXISTS(SELECT 1 FROM email_codes WHERE email=(SELECT email FROM users WHERE id=$1))",
	} {
		var ok bool
		if err := pool.QueryRow(ctx, query, memberID).Scan(&ok); err != nil || !ok {
			t.Fatalf("删除后的状态不符: %s, err=%v", query, err)
		}
	}
}
