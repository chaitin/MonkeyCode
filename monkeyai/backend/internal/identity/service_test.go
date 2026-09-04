package identity

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
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
