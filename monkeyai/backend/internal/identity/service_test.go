package identity

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestClientRegistry(t *testing.T) {
	tests := map[string]string{
		"monkeyai-desktop": "monkeyai-desktop://oauth/callback",
		"monkeyai-mobile":  "monkeyai-mobile://oauth/callback",
	}
	for clientID, redirectURI := range tests {
		client, ok := Clients[clientID]
		if !ok || client.RedirectURI != redirectURI {
			t.Fatalf("client %s = %#v", clientID, client)
		}
	}
}

func TestValidChallenge(t *testing.T) {
	verifier := "0123456789012345678901234567890123456789012"
	digest := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	if !validChallenge(challenge) {
		t.Fatalf("challenge 应有效: %s", challenge)
	}
	if validChallenge("invalid") {
		t.Fatal("短 challenge 不应有效")
	}
}

func TestBeginAuthorizationRejectsUnknownClientBeforeDatabase(t *testing.T) {
	service := &Service{}
	_, err := service.BeginAuthorization(t.Context(), url.Values{
		"response_type":         {"code"},
		"client_id":             {"unknown"},
		"redirect_uri":          {"unknown://callback"},
		"state":                 {"state"},
		"code_challenge":        {"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		"code_challenge_method": {"S256"},
	})
	if err == nil {
		t.Fatal("未知客户端应被拒绝")
	}
}

func TestAuthorizationRequestUsesClientRedirectURI(t *testing.T) {
	service := &Service{
		now:        func() time.Time { return time.Unix(1_700_000_000, 0) },
		requestTTL: 10 * time.Minute,
	}
	redirectURI := "http://127.0.0.1:54321/oauth/callback"
	request, err := service.newAuthorizationRequest(url.Values{
		"response_type":         {"code"},
		"client_id":             {"monkeyai-desktop"},
		"redirect_uri":          {redirectURI},
		"state":                 {"state"},
		"code_challenge":        {"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		"code_challenge_method": {"S256"},
	})
	if err != nil {
		t.Fatalf("动态 redirect_uri 不应被拒绝: %v", err)
	}
	if request.RedirectURI != redirectURI {
		t.Fatalf("redirect_uri = %q, want %q", request.RedirectURI, redirectURI)
	}
}

func TestUpstreamLoginRequiresClientAuthorizationRequest(t *testing.T) {
	service := &Service{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/auth/v1/oauth/github/start", nil)

	service.startUpstream(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", recorder.Code)
	}
	if got := recorder.Body.String(); got != "{\"error\":{\"code\":\"request_required\",\"message\":\"缺少客户端授权请求\"}}\n" {
		t.Fatalf("body = %q", got)
	}
}

func TestValidateUpstreamUserForAdminLogin(t *testing.T) {
	tests := []struct {
		name      string
		user      User
		adminOnly bool
		want      error
	}{
		{name: "active admin can use admin login", user: User{Role: "admin", Status: "active"}, adminOnly: true},
		{name: "regular user cannot use admin login", user: User{Role: "user", Status: "active"}, adminOnly: true, want: ErrAdminRoleRequired},
		{name: "disabled admin cannot use admin login", user: User{Role: "admin", Status: "disabled"}, adminOnly: true, want: ErrUserDisabled},
		{name: "admin cannot enter client flow", user: User{Role: "admin", Status: "active"}, want: ErrAdminPasswordRequired},
		{name: "regular user can enter client flow", user: User{Role: "user", Status: "active"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateUpstreamUser(test.user, test.adminOnly)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestAdminOAuthResultURL(t *testing.T) {
	service := &Service{adminURL: "https://admin.example.com"}
	state := LoginState{Purpose: loginPurposeAdmin}

	if got := service.upstreamResultURL(state, ""); got != "https://admin.example.com/login" {
		t.Fatalf("success URL = %q", got)
	}
	if got := service.upstreamResultURL(state, "admin_role_required"); got != "https://admin.example.com/login?oauth_error=admin_role_required" {
		t.Fatalf("error URL = %q", got)
	}
}
