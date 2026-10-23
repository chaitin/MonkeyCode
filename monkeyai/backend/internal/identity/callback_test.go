package identity

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func callbackAuthorizationValues(clientID, redirectURI string) (url.Values, string) {
	verifier := strings.Repeat("v", 64)
	digest := sha256.Sum256([]byte(verifier))
	return url.Values{
		"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {redirectURI},
		"state": {"callback-review"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}, "code_challenge_method": {"S256"},
	}, verifier
}

func TestClientCallbackRedirectPolicy(t *testing.T) {
	for _, tc := range []struct {
		client, redirect string
		allowed          bool
	}{
		{"monkeyai-desktop", "monkeyai-desktop://oauth/callback", true},
		{"monkeyai-mobile", "monkeyai-mobile://oauth/callback", true},
		{"monkeyai-desktop", "http://127.0.0.1:54321/oauth/callback", true},
		{"monkeyai-desktop", "http://[::1]:54321/oauth/callback", true},
		{"monkeyai-desktop", "http://127.0.0.1:1/oauth/callback", true},
		{"monkeyai-desktop", "http://127.0.0.1:80/oauth/callback", true},
		{"monkeyai-desktop", "http://127.0.0.1:65535/oauth/callback", true},
		{"unknown", "monkeyai-desktop://oauth/callback", false},
		{RuntimeClientID, "http://127.0.0.1:54321/oauth/callback", false},
		{"monkeyai-mobile", "http://127.0.0.1:54321/oauth/callback", false},
		{"monkeyai-desktop", "monkeyai-mobile://oauth/callback", false},
		{"monkeyai-desktop", "https://oauth-audit.invalid/callback", false},
		{"monkeyai-desktop", "https://attacker.example/oauth/callback", false},
		{"monkeyai-desktop", "javascript:alert(1)//", false},
		{"monkeyai-desktop", "data:text/html,test", false},
		{"monkeyai-desktop", "//attacker.example/callback", false},
		{"monkeyai-desktop", "/oauth/callback", false},
		{"monkeyai-desktop", "monkeyai-desktop://oauth/callback?next=https://attacker.example", false},
		{"monkeyai-desktop", "monkeyai-desktop://oauth/callback#", false},
		{"monkeyai-desktop", "monkeyai-desktop://oauth@attacker.example/callback", false},
		{"monkeyai-desktop", "http://localhost:54321/oauth/callback", true},
		{"monkeyai-desktop", "http://localhost:1/oauth/callback", true},
		{"monkeyai-desktop", "http://localhost:80/oauth/callback", true},
		{"monkeyai-desktop", "http://localhost:65535/oauth/callback", true},
		{"monkeyai-mobile", "http://localhost:54321/oauth/callback", false},
		{RuntimeClientID, "http://localhost:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://localhost.attacker.example:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://localhost@attacker.example:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://attacker@localhost:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://localhost/oauth/callback", false},
		{"monkeyai-desktop", "http://localhost:0/oauth/callback", false},
		{"monkeyai-desktop", "http://localhost:65536/oauth/callback", false},
		{"monkeyai-desktop", "http://localhost:05432/oauth/callback", false},
		{"monkeyai-desktop", "https://localhost:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://localhost:54321/other", false},
		{"monkeyai-desktop", "http://localhost:54321/oauth/%63allback", false},
		{"monkeyai-desktop", "http://localhost:54321/oauth/callback?next=external", false},
		{"monkeyai-desktop", "http://localhost:54321/oauth/callback#fragment", false},
		{"monkeyai-desktop", "http://127.0.0.1.attacker.example:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://127.0.0.1@attacker.example:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://attacker@127.0.0.1:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://[::ffff:127.0.0.1]:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://[::1%25eth0]:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://127.1:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://2130706433:54321/oauth/callback", false},
		{"monkeyai-desktop", "https://127.0.0.1:54321/oauth/callback", false},
		{"monkeyai-desktop", "http://127.0.0.1/oauth/callback", false},
		{"monkeyai-desktop", "http://127.0.0.1:0/oauth/callback", false},
		{"monkeyai-desktop", "http://127.0.0.1:65536/oauth/callback", false},
		{"monkeyai-desktop", "http://127.0.0.1:05432/oauth/callback", false},
		{"monkeyai-desktop", "http://127.0.0.1:54321/other", false},
		{"monkeyai-desktop", "http://127.0.0.1:54321/oauth/%63allback", false},
		{"monkeyai-desktop", "http://127.0.0.1:54321/oauth/callback?", false},
		{"monkeyai-desktop", "http://127.0.0.1:54321/oauth/callback?next=external", false},
		{"monkeyai-desktop", "http://127.0.0.1:54321/oauth/callback#", false},
		{"monkeyai-desktop", " http://127.0.0.1:54321/oauth/callback", false},
		{"monkeyai-desktop", "", false},
	} {
		t.Run(tc.client+"/"+tc.redirect, func(t *testing.T) {
			s := NewService(nil, nil, "https://ai.example.com")
			values, _ := callbackAuthorizationValues(tc.client, tc.redirect)
			request, err := s.newAuthorizationRequest(values)
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v error=%v", tc.allowed, err)
			}
			if tc.allowed && request.RedirectURI != tc.redirect {
				t.Fatalf("callback was rewritten: %q", request.RedirectURI)
			}
			if !tc.allowed {
				// A rejected destination must not need or write to a database.
				response := httptest.NewRecorder()
				s.OAuthRouter().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/authorize?"+values.Encode(), nil))
				if response.Code != http.StatusBadRequest || response.Header().Get("Location") != "" {
					t.Fatalf("unsafe request response: status=%d location=%q", response.Code, response.Header().Get("Location"))
				}
			}
		})
	}
}

func TestStoredUnsafeAuthorizationCannotCompleteOrExchange(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, authenticationStub{json.RawMessage(`{}`)}, "https://ai.example.com")
	user := grantUser(t, s)
	cookie := &http.Cookie{Name: sessionCookie, Value: "stored-callback-review"}
	if err := s.createBrowserSession(t.Context(), user.ID, tokenHash(cookie.Value), "password", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	for _, callback := range []string{"https://oauth-audit.invalid/callback", "javascript:alert(1)//"} {
		t.Run(callback, func(t *testing.T) {
			values, verifier := callbackAuthorizationValues("monkeyai-desktop", Clients["monkeyai-desktop"].RedirectURI)
			request, err := s.newAuthorizationRequest(values)
			if err != nil {
				t.Fatal(err)
			}
			request.RedirectURI = callback
			if err := s.createAuthorizationRequest(t.Context(), &request); err != nil {
				t.Fatal(err)
			}
			get := httptest.NewRecorder()
			s.AuthRouter().ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/client-requests/"+request.ID, nil))
			if get.Code != http.StatusNotFound {
				t.Fatalf("old unsafe request exposed: %d %s", get.Code, get.Body.String())
			}
			req := httptest.NewRequest(http.MethodPost, "/client-requests/"+request.ID+"/complete", strings.NewReader(`{"approved_scopes":[]}`))
			req.AddCookie(cookie)
			req.Header.Set("Origin", "https://ai.example.com")
			req.Header.Set("X-CSRF-Token", consentToken(req, request.ID))
			response := httptest.NewRecorder()
			s.AuthRouter().ServeHTTP(response, req)
			if response.Code != http.StatusConflict {
				t.Fatalf("old unsafe request completed: %d %s", response.Code, response.Body.String())
			}
			stored, err := s.authorizationRequest(t.Context(), request.ID)
			if err != nil || stored.CompletedAt != nil {
				t.Fatalf("rejected request was consumed: %v", err)
			}
			var count int
			if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM oauth_authorization_codes WHERE authorization_request_id=$1", request.ID).Scan(&count); err != nil || count != 0 {
				t.Fatalf("rejected request issued %d codes: %v", count, err)
			}
			// Also simulate a code issued before the callback policy was deployed.
			code := "old-code-" + request.ID
			if err := s.storeAuthorizationCode(t.Context(), request, user.ID, tokenHash(code), time.Now().Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			for _, submitted := range []string{callback, Clients[request.ClientID].RedirectURI} {
				if _, err := s.ExchangeCode(t.Context(), request.ClientID, submitted, code, verifier); err == nil {
					t.Fatalf("old unsafe code exchanged with %q", submitted)
				}
			}
			old, err := s.authorizationCode(t.Context(), tokenHash(code))
			if err != nil || old.RedeemedAt != nil {
				t.Fatalf("rejected code was redeemed: %v", err)
			}
		})
	}
}

func TestRegisteredCallbackConsentAndPKCERoundTrip(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, authenticationStub{json.RawMessage(`{}`)}, "https://ai.example.com")
	user := grantUser(t, s)
	cookie := &http.Cookie{Name: sessionCookie, Value: "callback-roundtrip"}
	if err := s.createBrowserSession(t.Context(), user.ID, tokenHash(cookie.Value), "password", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ client, redirect string }{
		{"monkeyai-desktop", "monkeyai-desktop://oauth/callback"},
		{"monkeyai-mobile", "monkeyai-mobile://oauth/callback"},
		{"monkeyai-desktop", "http://127.0.0.1:54321/oauth/callback"},
		{"monkeyai-desktop", "http://[::1]:54321/oauth/callback"},
		{"monkeyai-desktop", "http://localhost:54321/oauth/callback"},
	} {
		t.Run(tc.redirect, func(t *testing.T) {
			values, verifier := callbackAuthorizationValues(tc.client, tc.redirect)
			request, err := s.BeginAuthorization(t.Context(), values)
			if err != nil {
				t.Fatal(err)
			}
			metadataRequest := httptest.NewRequest(http.MethodGet, "/client-requests/"+request.ID, nil)
			metadataRequest.AddCookie(cookie)
			metadataResponse := httptest.NewRecorder()
			s.AuthRouter().ServeHTTP(metadataResponse, metadataRequest)
			var metadata struct {
				Client   Client `json:"client"`
				CSRF     string `json:"csrf_token"`
				Required bool   `json:"consent_required"`
			}
			if err := json.Unmarshal(metadataResponse.Body.Bytes(), &metadata); err != nil || !metadata.Required || metadata.CSRF == "" || metadata.Client.RedirectURI != tc.redirect {
				t.Fatalf("incorrect destination/consent: %s %v", metadataResponse.Body.String(), err)
			}
			complete := httptest.NewRequest(http.MethodPost, "/client-requests/"+request.ID+"/complete", strings.NewReader(`{"approved_scopes":[]}`))
			complete.AddCookie(cookie)
			complete.Header.Set("Origin", "https://ai.example.com")
			complete.Header.Set("X-CSRF-Token", metadata.CSRF)
			response := httptest.NewRecorder()
			s.AuthRouter().ServeHTTP(response, complete)
			if response.Code != 200 {
				t.Fatalf("complete: %d %s", response.Code, response.Body.String())
			}
			var result struct {
				Launch string `json:"launch_url"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			callback, err := url.Parse(result.Launch)
			if err != nil || callback.Query().Get("state") != values.Get("state") {
				t.Fatalf("callback: %s %v", result.Launch, err)
			}
			code := callback.Query().Get("code")
			callback.RawQuery = ""
			if callback.String() != tc.redirect || code == "" {
				t.Fatalf("wrong callback: %s", result.Launch)
			}
			if _, err := s.ExchangeCode(t.Context(), tc.client, tc.redirect, code, strings.Repeat("x", 64)); err == nil {
				t.Fatal("incorrect PKCE verifier accepted")
			}
			token, err := s.ExchangeCode(t.Context(), tc.client, tc.redirect, code, verifier)
			if err != nil || token.AccessToken == "" || token.RefreshToken == "" {
				t.Fatalf("token exchange: %v", err)
			}
			if _, err := s.ExchangeCode(t.Context(), tc.client, tc.redirect, code, verifier); err == nil {
				t.Fatal("authorization code replay accepted")
			}
		})
	}
}
