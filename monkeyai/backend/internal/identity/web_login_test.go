package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWebOAuthDestination(t *testing.T) {
	s := NewService(nil, nil, "https://ai.example.com")
	for code, path := range map[string]string{"": "/login", "user_disabled": "/login?oauth_error=user_disabled"} {
		if got := s.upstreamResultURL(LoginState{Purpose: loginPurposeWeb}, code); got != s.publicURL+path {
			t.Fatal(got)
		}
	}
}

func TestSupervisorWebLogin(t *testing.T) {
	pool := emailDatabase(t)
	ctx := t.Context()
	sender := &mailStub{}
	s := newTestService(pool, authenticationStub{json.RawMessage(`{"password_enabled":true,"email_code_enabled":true}`)}, "http://localhost").WithEmailSender(sender)
	const password = "web-login-password"
	hash, err := hashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	user, err := s.insertUser(ctx, "主管", "lead@example.test", "user", hash)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `WITH g AS (INSERT INTO groups(name) VALUES('测试分组') RETURNING id) INSERT INTO group_users(group_id,user_id,assigned_by_user_id,is_supervisor) SELECT id,$1,$1,true FROM g`, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/login", "/email/login"} {
		input := emailInput{Email: user.Email, Password: password}
		if path == "/email/login" {
			authCall(t, s, "/email/code", emailInput{Email: user.Email, Purpose: "login"}, 200)
			input.Code = sender.code
		}
		res := authCall(t, s, path, input, 200)
		var got User
		if json.Unmarshal(res.Body.Bytes(), &got) != nil || got.Role != "group_admin" {
			t.Fatal(res.Body.String())
		}
		req := httptest.NewRequest("GET", "/session", nil)
		req.AddCookie(res.Result().Cookies()[0])
		res = httptest.NewRecorder()
		s.AuthRouter().ServeHTTP(res, req)
		var session struct {
			Authenticated bool
			User          User
		}
		if json.Unmarshal(res.Body.Bytes(), &session) != nil || !session.Authenticated || session.User.Role != "group_admin" {
			t.Fatal(res.Body.String())
		}
		res = httptest.NewRecorder()
		s.RequireAdmin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("主管不应获得管理 API 权限") })).ServeHTTP(res, req)
		if res.Code != 403 {
			t.Fatal(res.Code)
		}
	}
}
