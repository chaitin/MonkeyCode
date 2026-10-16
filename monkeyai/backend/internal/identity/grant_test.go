package identity

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
)

func TestAuthorizationScopes(t *testing.T) {
	for _, tc := range []struct {
		client, value string
		valid         bool
	}{
		{"monkeyai-desktop", "device:bind device:publish session:report", true},
		{"monkeyai-mobile", "device:connect session:read files:read", true},
		{"monkeyai-mobile", "device:publish", false},
		{"monkeyai-desktop", "admin:write", false},
		{"monkeyai-desktop", "", true},
	} {
		_, err := parseScopes(tc.client, tc.value)
		if (err == nil) != tc.valid {
			t.Fatalf("client=%s scopes=%s error=%v", tc.client, tc.value, err)
		}
	}
	scopes, err := parseScopes("monkeyai-desktop", "files:read session:read files:read")
	if err != nil || !slices.Equal(scopes, []string{"files:read", "session:read"}) {
		t.Fatalf("未规范化权限：%v %v", scopes, err)
	}
	if _, err := approvedScopes(scopes, []string{"device:publish"}); err == nil {
		t.Fatal("批准不应扩权")
	}
	if _, err := approvedScopes(scopes, []string{}); err != nil {
		t.Fatal(err)
	}
	if (Principal{Audience: Audience}).Has("device:connect") {
		t.Fatal("旧身份不应获得远程权限")
	}
	if (Principal{Audience: "other", Scopes: scopes}).Has("files:read") {
		t.Fatal("受众不匹配不应放行")
	}
}

func TestDesktopAuthorizationDefaultsRuntimeScopes(t *testing.T) {
	s := NewService(nil, nil, "http://localhost").WithDeviceAuthorization("server", []byte(strings.Repeat("k", 32)), &deviceRegistryStub{})
	verifier := strings.Repeat("v", 64)
	digest := sha256.Sum256([]byte(verifier))
	request, err := s.newAuthorizationRequest(url.Values{
		"response_type": {"code"}, "client_id": {"monkeyai-desktop"},
		"redirect_uri": {"monkeyai-desktop://oauth/callback"}, "state": {"scope-test"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}, "code_challenge_method": {"S256"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"device:bind", "device:connect", "device:publish", "session:report"}
	if !slices.Equal(request.Scopes, want) {
		t.Fatalf("Desktop 默认远程权限 = %v, want %v", request.Scopes, want)
	}
}

func grantRequest(t *testing.T, s *Service, scopes string) (AuthorizationRequest, string) {
	t.Helper()
	verifier := strings.Repeat("v", 64)
	digest := sha256.Sum256([]byte(verifier))
	r, err := s.BeginAuthorization(t.Context(), url.Values{"response_type": {"code"}, "client_id": {"monkeyai-desktop"},
		"redirect_uri": {"monkeyai-desktop://oauth/callback"}, "state": {"grant-test"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}, "code_challenge_method": {"S256"}, "scope": {scopes}})
	if err != nil {
		t.Fatal(err)
	}
	return r, verifier
}

func grantToken(t *testing.T, s *Service, userID, scopes string) Token {
	t.Helper()
	r, verifier := grantRequest(t, s, scopes)
	approval := strings.Fields(scopes)
	callback, err := s.completeAuthorization(t.Context(), r.ID, userID, &approval)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(callback)
	if err != nil {
		t.Fatal(err)
	}
	token, err := s.ExchangeCode(t.Context(), r.ClientID, r.RedirectURI, u.Query().Get("code"), verifier)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func grantUser(t *testing.T, s *Service) User {
	t.Helper()
	user, err := s.insertUser(t.Context(), "授权测试", "grants@example.com", "user", "")
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func tokenPrincipal(t *testing.T, s *Service, raw string, want int) Principal {
	t.Helper()
	var p Principal
	h := s.RequireAgent(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, _ = PrincipalFromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+raw)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, req)
	if response.Code != want {
		t.Fatalf("认证状态=%d want=%d", response.Code, want)
	}
	return p
}

func TestGrantRotationAndReplay(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "https://ai.example.com")
	user := grantUser(t, s)
	first := grantToken(t, s, user.ID, "device:bind device:publish session:report")
	other := grantToken(t, s, user.ID, "device:connect session:read")
	p := tokenPrincipal(t, s, first.AccessToken, http.StatusNoContent)
	if p.GrantID != first.GrantID || !p.Has("device:publish") || p.MachineID != "" {
		t.Fatalf("Principal 错误：%+v", p)
	}
	rotated, err := s.Refresh(t.Context(), "monkeyai-desktop", first.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if rotated.GrantID != first.GrantID || rotated.Scope != first.Scope {
		t.Fatal("刷新改变授权族或权限")
	}
	tokenPrincipal(t, s, first.AccessToken, http.StatusUnauthorized)
	tokenPrincipal(t, s, rotated.AccessToken, http.StatusNoContent)
	if _, err := s.Refresh(t.Context(), "monkeyai-mobile", first.RefreshToken); err == nil {
		t.Fatal("错误 client 应拒绝")
	}
	tokenPrincipal(t, s, rotated.AccessToken, http.StatusNoContent)
	if _, err := s.Refresh(t.Context(), "monkeyai-desktop", first.RefreshToken); err == nil {
		t.Fatal("重放应拒绝")
	}
	tokenPrincipal(t, s, rotated.AccessToken, http.StatusUnauthorized)
	tokenPrincipal(t, s, other.AccessToken, http.StatusNoContent)
	valid, err := s.VerifyGrant(t.Context(), p)
	if err != nil || valid {
		t.Fatalf("重放后的授权族仍有效：%t %v", valid, err)
	}
}

func TestConcurrentRefreshRevokesReplayedFamily(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "http://localhost")
	user := grantUser(t, s)
	first := grantToken(t, s, user.ID, "")
	var wg sync.WaitGroup
	results := make(chan Token, 2)
	errors := make(chan error, 2)
	for range 2 {
		wg.Go(func() {
			token, err := s.Refresh(t.Context(), "monkeyai-desktop", first.RefreshToken)
			if err != nil {
				errors <- err
			} else {
				results <- token
			}
		})
	}
	wg.Wait()
	if len(results) != 1 || len(errors) != 1 {
		t.Fatalf("并发兑换结果成功=%d 失败=%d", len(results), len(errors))
	}
	tokenPrincipal(t, s, (<-results).AccessToken, http.StatusUnauthorized)
}

func TestRevokeOldTokenRevokesOnlyItsFamily(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "http://localhost")
	user := grantUser(t, s)
	first := grantToken(t, s, user.ID, "")
	other := grantToken(t, s, user.ID, "")
	rotated, err := s.Refresh(t.Context(), "monkeyai-desktop", first.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.revokeToken(t.Context(), tokenHash(first.AccessToken), "monkeyai-mobile"); err != nil {
		t.Fatal(err)
	}
	tokenPrincipal(t, s, rotated.AccessToken, http.StatusNoContent)
	if err := s.revokeToken(t.Context(), tokenHash(first.RefreshToken), "monkeyai-desktop"); err != nil {
		t.Fatal(err)
	}
	tokenPrincipal(t, s, rotated.AccessToken, http.StatusUnauthorized)
	tokenPrincipal(t, s, other.AccessToken, http.StatusNoContent)
	if err := s.revokeToken(t.Context(), tokenHash(first.RefreshToken), "monkeyai-desktop"); err != nil {
		t.Fatal(err)
	}
}

func TestScopedConsentRequiresBrowserApproval(t *testing.T) {
	for _, origin := range []string{"https://ai.example.com", "http://203.0.113.20:8080", "http://192.168.1.20:8080"} {
		t.Run(origin, func(t *testing.T) { testScopedConsent(t, origin) })
	}
}

func testScopedConsent(t *testing.T, origin string) {
	t.Helper()
	pool := emailDatabase(t)
	s := NewService(pool, authenticationStub{json.RawMessage(`{}`)}, origin)
	user := grantUser(t, s)
	r, verifier := grantRequest(t, s, "device:connect session:read")
	if _, err := s.CompleteAuthorization(t.Context(), r.ID, user.ID); err == nil {
		t.Fatal("不能自动批准新权限")
	}
	cookie := &http.Cookie{Name: sessionCookie, Value: "browser-consent-test"}
	if err := s.createBrowserSession(t.Context(), user.ID, tokenHash(cookie.Value), "password", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/client-requests/"+r.ID+"/complete", nil)
	request.AddCookie(cookie)
	csrf := consentToken(request, r.ID)
	for _, tc := range []struct {
		name, csrf, origin, body string
		want                     int
	}{
		{"自动完成", "", "", "", http.StatusForbidden},
		{"错误 CSRF", "wrong", "", `{"approved_scopes":["session:read"]}`, http.StatusForbidden},
		{"跨源", csrf, "https://evil.example.com", `{"approved_scopes":["session:read"]}`, http.StatusForbidden},
		{"扩权", csrf, origin, `{"approved_scopes":["device:manage"]}`, http.StatusConflict},
		{"收窄批准", csrf, origin, `{"approved_scopes":["session:read"]}`, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/client-requests/"+r.ID+"/complete", strings.NewReader(tc.body))
			req.AddCookie(cookie)
			req.Header.Set("X-CSRF-Token", tc.csrf)
			req.Header.Set("Origin", tc.origin)
			response := httptest.NewRecorder()
			s.AuthRouter().ServeHTTP(response, req)
			if response.Code != tc.want {
				t.Fatalf("状态=%d want=%d body=%s", response.Code, tc.want, response.Body.String())
			}
			if tc.want != http.StatusOK {
				return
			}
			var result struct {
				LaunchURL string `json:"launch_url"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			u, _ := url.Parse(result.LaunchURL)
			token, err := s.ExchangeCode(t.Context(), r.ClientID, r.RedirectURI, u.Query().Get("code"), verifier)
			if err != nil || token.Scope != "session:read" {
				t.Fatalf("批准范围未保留：%s %v", token.Scope, err)
			}
		})
	}
}

func TestGrantInfrastructureFailureIsNotInvalidGrant(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "http://localhost")
	pool.Close()
	_, err := s.Refresh(context.Background(), "monkeyai-desktop", "unavailable")
	var protocol protocolError
	if err == nil || errors.As(err, &protocol) {
		t.Fatalf("数据库故障不应误报凭据失效：%v", err)
	}
}

func TestLegacyGrantMigration(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "http://localhost")
	user := grantUser(t, s)
	for _, value := range []string{"old-a", "old-b"} {
		if _, err := pool.Exec(t.Context(), `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
		VALUES($1,'monkeyai-desktop',$2,$3,now()+interval '1 hour',now()+interval '1 day')`, user.ID, tokenHash(value), tokenHash(value+"-refresh")); err != nil {
			t.Fatal(err)
		}
	}
	first := tokenPrincipal(t, s, "old-a", http.StatusNoContent)
	second := tokenPrincipal(t, s, "old-b", http.StatusNoContent)
	if first.GrantID == second.GrantID || len(first.Scopes) != 0 || first.Has("device:bind") {
		t.Fatal("旧 token 未保持独立且无新增权限的兼容授权族")
	}
	rotated, err := s.Refresh(t.Context(), "monkeyai-desktop", "old-a-refresh")
	if err != nil || rotated.GrantID != first.GrantID || rotated.Scope != "" {
		t.Fatalf("兼容凭据刷新异常：%v", err)
	}
	g, err := sqlc.New(pool).GetGrant(t.Context(), first.GrantID)
	if err != nil || len(g.Scopes) != 0 {
		t.Fatalf("兼容授权异常：%v", err)
	}
}
