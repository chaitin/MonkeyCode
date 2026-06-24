package provider

import (
	"context"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

func TestGoogleProviderAuthCodeURLIncludesStateAndNonce(t *testing.T) {
	gp := &GoogleProvider{
		oauthConfig: &oauth2.Config{
			ClientID:    "client-id",
			RedirectURL: "http://localhost/callback",
			Scopes:      []string{"openid", "email", "profile"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
				TokenURL: "https://oauth2.googleapis.com/token",
			},
		},
	}

	got := gp.AuthCodeURL("state-1", "nonce-1")
	for _, want := range []string{"state=state-1", "nonce=nonce-1", "client_id=client-id"} {
		if !strings.Contains(got, want) {
			t.Fatalf("AuthCodeURL %q does not contain %q", got, want)
		}
	}
}

func TestGoogleProviderRejectsMissingIDToken(t *testing.T) {
	gp := &GoogleProvider{}

	_, err := gp.User(context.Background(), &oauth2.Token{AccessToken: "access-token"}, "nonce-1")
	if err == nil {
		t.Fatal("expected error")
	}
}
