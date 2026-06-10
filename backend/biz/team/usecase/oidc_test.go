package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestOIDCEmailDomainAllowed(t *testing.T) {
	if !oidcEmailDomainAllowed("alice@example.com", "example.com") {
		t.Fatal("expected domain to be allowed")
	}
	if oidcEmailDomainAllowed("alice@evil.com", "example.com") {
		t.Fatal("expected domain to be denied")
	}
}

func TestOIDCDisplayNameFallsBack(t *testing.T) {
	got := oidcDisplayName(&domain.OIDCExternalUser{Email: "alice@example.com"})
	if got != "alice" {
		t.Fatalf("display name = %q, want alice", got)
	}
}

func TestOIDCExternalUserLogAttrsSummarizesCallbackData(t *testing.T) {
	attrs := oidcExternalUserLogAttrs(&domain.OIDCExternalUser{
		Issuer:        "https://id.example.com/realms/mcai",
		Subject:       "fcf4de16-2676-414d-8779-aafddb3e8362",
		Email:         "alice@example.com",
		EmailVerified: true,
		Name:          "Alice",
		Username:      "alice",
		AvatarURL:     strings.Repeat("a", 300),
	})

	got := logAttrsMap(attrs)
	if got["issuer"] != "https://id.example.com/realms/mcai" {
		t.Fatalf("issuer attr = %v", got["issuer"])
	}
	if got["subject"] != "fcf4de16-2676-414d-8779-aafddb3e8362" {
		t.Fatalf("subject attr = %v", got["subject"])
	}
	if got["subject_len"] != 36 {
		t.Fatalf("subject_len attr = %v", got["subject_len"])
	}
	if got["email"] != "alice@example.com" {
		t.Fatalf("email attr = %v", got["email"])
	}
	if got["email_verified"] != true {
		t.Fatalf("email_verified attr = %v", got["email_verified"])
	}
	if got["username"] != "alice" {
		t.Fatalf("username attr = %v", got["username"])
	}
	if got["avatar_url_len"] != 300 {
		t.Fatalf("avatar_url_len attr = %v", got["avatar_url_len"])
	}
	if got["avatar_url"] == strings.Repeat("a", 300) {
		t.Fatal("avatar_url should be shortened for debug logs")
	}
}

func TestTeamOIDCUsecaseDefaultPublicConfigReturnsDisabledWhenNotConfigured(t *testing.T) {
	u := &TeamOIDCUsecase{
		repo: &defaultOIDCRepoStub{err: &db.NotFoundError{}},
		cfg:  &config.Config{},
	}

	resp, err := u.DefaultPublicConfig(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if resp.Enabled {
		t.Fatal("expected default OIDC config disabled")
	}
}

func logAttrsMap(attrs []any) map[string]any {
	m := make(map[string]any, len(attrs)/2)
	for i := 0; i+1 < len(attrs); i += 2 {
		key, _ := attrs[i].(string)
		m[key] = attrs[i+1]
	}
	return m
}

func TestTeamOIDCUsecaseDefaultPublicConfigReturnsLoginURL(t *testing.T) {
	teamID := uuid.New()
	cfg := &config.Config{}
	cfg.Server.BaseURL = "http://monkeycode.example.com/"
	u := &TeamOIDCUsecase{
		repo: &defaultOIDCRepoStub{cfg: &db.TeamOIDCConfig{
			TeamID:      teamID,
			Enabled:     true,
			DisplayName: "公司账号登录",
		}},
		cfg: cfg,
	}

	resp, err := u.DefaultPublicConfig(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !resp.Enabled {
		t.Fatal("expected default OIDC config enabled")
	}
	if resp.TeamID != teamID {
		t.Fatalf("team id = %s, want %s", resp.TeamID, teamID)
	}
	if resp.DisplayName != "公司账号登录" {
		t.Fatalf("display name = %q", resp.DisplayName)
	}
	wantURL := "http://monkeycode.example.com/api/v1/users/oidc/login?team_id=" + teamID.String()
	if resp.LoginURL != wantURL {
		t.Fatalf("login url = %q, want %q", resp.LoginURL, wantURL)
	}
}

type defaultOIDCRepoStub struct {
	domain.TeamOIDCRepo
	cfg *db.TeamOIDCConfig
	err error
}

func (s *defaultOIDCRepoStub) GetDefaultEnabledConfig(ctx context.Context) (*db.TeamOIDCConfig, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.cfg == nil {
		return nil, errors.New("unexpected empty config")
	}
	return s.cfg, nil
}
