package provider

import (
	"context"

	"golang.org/x/oauth2"
)

type Name string

const (
	Google Name = "google"
	Github Name = "github"
)

type ExternalUser struct {
	Provider      Name
	IdentityID    string
	Email         string
	EmailVerified bool
	Username      string
	Name          string
	AvatarURL     string
}

type Provider interface {
	Name() Name
	AuthCodeURL(state, nonce string) string
	Exchange(ctx context.Context, code string) (*oauth2.Token, error)
	User(ctx context.Context, token *oauth2.Token, nonce string) (*ExternalUser, error)
}
