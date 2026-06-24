package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/oauth2"
)

func TestGithubProviderUsesPrimaryVerifiedEmail(t *testing.T) {
	gp, closeServer := newGithubProviderTestServer(t, `[{"email":"primary@example.com","primary":true,"verified":true},{"email":"other@example.com","primary":false,"verified":true}]`)
	defer closeServer()

	user, err := gp.User(context.Background(), &oauth2.Token{AccessToken: "token"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if user.Email != "primary@example.com" {
		t.Fatalf("email = %q", user.Email)
	}
	if !user.EmailVerified {
		t.Fatal("email should be verified")
	}
}

func TestGithubProviderFallsBackToAnyVerifiedEmail(t *testing.T) {
	gp, closeServer := newGithubProviderTestServer(t, `[{"email":"primary@example.com","primary":true,"verified":false},{"email":"other@example.com","primary":false,"verified":true}]`)
	defer closeServer()

	user, err := gp.User(context.Background(), &oauth2.Token{AccessToken: "token"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if user.Email != "other@example.com" {
		t.Fatalf("email = %q", user.Email)
	}
}

func TestGithubProviderRejectsMissingVerifiedEmail(t *testing.T) {
	gp, closeServer := newGithubProviderTestServer(t, `[{"email":"primary@example.com","primary":true,"verified":false}]`)
	defer closeServer()

	_, err := gp.User(context.Background(), &oauth2.Token{AccessToken: "token"}, "")
	if err == nil {
		t.Fatal("expected error")
	}
}

func newGithubProviderTestServer(t *testing.T, emailsJSON string) (*GithubProvider, func()) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/user":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":12345,"login":"alice","name":"Alice","avatar_url":"https://example.com/avatar.png"}`))
		case "/user/emails":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(emailsJSON))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	gp := &GithubProvider{
		httpClient: srv.Client(),
		apiBaseURL: srv.URL + "/",
		oauthConfig: &oauth2.Config{
			ClientID:     "client-id",
			ClientSecret: "client-secret",
			RedirectURL:  "http://localhost/callback",
			Endpoint: oauth2.Endpoint{
				AuthURL:  srv.URL + "/login/oauth/authorize",
				TokenURL: srv.URL + "/login/oauth/access_token",
			},
		},
	}
	return gp, srv.Close
}
