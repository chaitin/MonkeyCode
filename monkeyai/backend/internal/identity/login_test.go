package identity

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestLoginRoles(t *testing.T) {
	pool := emailDatabase(t)
	const password = "long-password-123"
	hash, err := hashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range []struct {
		name    string
		role    string
		status  string
		promote bool
	}{
		{name: "user", role: "user", status: "active"},
		{name: "admin", role: "admin", status: "active"},
		{name: "promoted", role: "user", status: "active", promote: true},
		{name: "disabled_user", role: "user", status: "disabled"},
		{name: "disabled_admin", role: "admin", status: "disabled"},
	} {
		for _, method := range []struct {
			name  string
			path  string
			email bool
			admin bool
		}{
			{name: "password", path: "/login"},
			{name: "admin_password", path: "/admin/login", admin: true},
			{name: "email", path: "/email/login", email: true},
			{name: "admin_email", path: "/admin/email/login", email: true, admin: true},
		} {
			t.Run(account.name+"/"+method.name, func(t *testing.T) {
				sender := &mailStub{}
				s := NewService(pool, authenticationStub{json.RawMessage(`{"password_enabled":true,"email_code_enabled":true}`)}, "http://localhost", "http://localhost").WithEmailSender(sender)
				email := account.name + "." + method.name + "@example.com"
				user, err := s.insertUser(t.Context(), account.name, email, account.role, hash)
				if err != nil {
					t.Fatal(err)
				}
				input := emailInput{Email: email, Password: password}
				if method.email {
					authCall(t, s, "/email/code", emailInput{Email: email, Purpose: "login"}, http.StatusOK)
					input.Code = sender.code
				}
				role := account.role
				if account.promote {
					role = "admin"
				}
				if _, err := s.updateUser(t.Context(), user.ID, user.Name, role, account.status, ""); err != nil {
					t.Fatal(err)
				}
				want := http.StatusOK
				if account.status != "active" || method.admin && role != "admin" {
					want = http.StatusUnauthorized
				}
				response := authCall(t, s, method.path, input, want)
				cookies := response.Result().Cookies()
				if want != http.StatusOK {
					if len(cookies) != 0 {
						t.Fatal("登录被拒绝后不应创建会话")
					}
					return
				}
				var loggedIn User
				if err := json.Unmarshal(response.Body.Bytes(), &loggedIn); err != nil {
					t.Fatal(err)
				}
				if loggedIn.ID != user.ID || loggedIn.Role != role || len(cookies) != 1 {
					t.Fatalf("登录身份或会话异常: user=%+v cookies=%d", loggedIn, len(cookies))
				}
				if !method.admin {
					checkClientAuthorization(t, s, cookies[0], loggedIn)
				}
			})
		}
	}
}

func checkClientAuthorization(t *testing.T, s *Service, cookie *http.Cookie, user User) {
	t.Helper()
	const verifier = "012345678901234567890123456789012345678901234567890123456789"
	digest := sha256.Sum256([]byte(verifier))
	request, err := s.BeginAuthorization(t.Context(), url.Values{
		"response_type": {"code"}, "client_id": {"monkeyai-desktop"},
		"redirect_uri": {"monkeyai-desktop://oauth/callback"}, "state": {"login-state"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}, "code_challenge_method": {"S256"},
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/client-requests/"+request.ID+"/complete", nil)
	req.AddCookie(cookie)
	response := httptest.NewRecorder()
	s.AuthRouter().ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("客户端授权失败: status=%d body=%s", response.Code, response.Body.String())
	}
	var result struct {
		LaunchURL string `json:"launch_url"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	callback, err := url.Parse(result.LaunchURL)
	if err != nil {
		t.Fatal(err)
	}
	if callback.Query().Get("state") != request.State {
		t.Fatal("客户端回调未保留 state")
	}
	token, err := s.ExchangeCode(t.Context(), request.ClientID, request.RedirectURI, callback.Query().Get("code"), verifier)
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := s.Refresh(t.Context(), request.ClientID, token.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	agent := s.RequireAgent(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current, ok := UserFromContext(r.Context())
		if !ok || current.ID != user.ID || current.Role != user.Role {
			t.Fatalf("客户端身份异常: %+v", current)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	req.Header.Set("Authorization", "Bearer "+refreshed.AccessToken)
	response = httptest.NewRecorder()
	agent.ServeHTTP(response, req)
	if response.Code != http.StatusNoContent {
		t.Fatalf("客户端令牌不可用: status=%d body=%s", response.Code, response.Body.String())
	}
}
