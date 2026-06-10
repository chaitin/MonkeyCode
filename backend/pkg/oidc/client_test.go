package oidc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestNormalizeIssuer(t *testing.T) {
	got := NormalizeIssuer("https://id.example.com/")
	if got != "https://id.example.com" {
		t.Fatalf("NormalizeIssuer = %q", got)
	}
}

func TestDiscoverFetchesConfiguration(t *testing.T) {
	var issuer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"issuer":"` + issuer + `",
			"authorization_endpoint":"` + issuer + `/authorize",
			"token_endpoint":"` + issuer + `/token",
			"jwks_uri":"` + issuer + `/jwks",
			"userinfo_endpoint":"` + issuer + `/userinfo"
		}`))
	}))
	defer srv.Close()
	issuer = srv.URL

	client := NewClient(http.DefaultClient)
	doc, err := client.Discover(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if doc.AuthorizationEndpoint != srv.URL+"/authorize" {
		t.Fatalf("authorization endpoint = %q", doc.AuthorizationEndpoint)
	}
}

func TestDiscoverPreservesTrailingSlashIssuer(t *testing.T) {
	var issuer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"issuer":"` + issuer + `",
			"authorization_endpoint":"` + issuer + `authorize",
			"token_endpoint":"` + issuer + `token",
			"jwks_uri":"` + issuer + `jwks",
			"userinfo_endpoint":"` + issuer + `userinfo"
		}`))
	}))
	defer srv.Close()
	issuer = srv.URL + "/"

	client := NewClient(http.DefaultClient)
	doc, err := client.Discover(context.Background(), issuer)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Issuer != issuer {
		t.Fatalf("issuer = %q, want %q", doc.Issuer, issuer)
	}
}

func TestValidateExternalUserRequiresVerifiedEmail(t *testing.T) {
	err := ValidateExternalUser(&domain.OIDCExternalUser{
		Issuer:        "https://id.example.com",
		Subject:       "sub-1",
		Email:         "alice@example.com",
		EmailVerified: false,
	})
	if err == nil {
		t.Fatal("expected unverified email error")
	}
}
