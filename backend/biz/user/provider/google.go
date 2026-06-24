package provider

import (
	"context"
	"errors"
	"net/http"

	"golang.org/x/oauth2"

	"github.com/chaitin/MonkeyCode/backend/config"
	oidcpkg "github.com/chaitin/MonkeyCode/backend/pkg/oidc"
)

const googleIssuer = "https://accounts.google.com"

type GoogleProvider struct {
	httpClient  *http.Client
	issuer      string
	oidcClient  *oidcpkg.Client
	oauthConfig *oauth2.Config
}

func NewGoogle(cfg config.OAuthLoginProviderConfig, serverBaseURL string, httpClient *http.Client) *GoogleProvider {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &GoogleProvider{
		httpClient: httpClient,
		issuer:     googleIssuer,
		oidcClient: oidcpkg.NewClient(httpClient),
		oauthConfig: &oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  oauthCallbackURL(cfg.RedirectURL, serverBaseURL, Google),
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
				TokenURL: "https://oauth2.googleapis.com/token",
			},
		},
	}
}

func (p *GoogleProvider) Name() Name {
	return Google
}

func (p *GoogleProvider) AuthCodeURL(state, nonce string) string {
	return p.oauthConfig.AuthCodeURL(state, oauth2.SetAuthURLParam("nonce", nonce))
}

func (p *GoogleProvider) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, p.httpClient)
	return p.oauthConfig.Exchange(ctx, code)
}

func (p *GoogleProvider) User(ctx context.Context, token *oauth2.Token, nonce string) (*ExternalUser, error) {
	if token == nil {
		return nil, errors.New("google token is required")
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return nil, errors.New("google id_token is required")
	}
	oidcClient := p.oidcClient
	if oidcClient == nil {
		oidcClient = oidcpkg.NewClient(p.httpClient)
	}
	issuer := p.issuer
	if issuer == "" {
		issuer = googleIssuer
	}
	doc, err := oidcClient.Discover(ctx, issuer)
	if err != nil {
		return nil, err
	}
	external, err := oidcClient.VerifyIDToken(ctx, doc, oidcpkg.Config{ClientID: p.oauthConfig.ClientID}, rawIDToken, nonce)
	if err != nil {
		return nil, err
	}
	if external.Email == "" || external.Name == "" || external.AvatarURL == "" {
		enriched, infoErr := oidcClient.UserInfo(ctx, doc, p.oauthConfig.TokenSource(ctx, token), external)
		if enriched != nil {
			external = enriched
		}
		if infoErr != nil && external.Email == "" {
			return nil, infoErr
		}
	}
	return &ExternalUser{
		Provider:      Google,
		IdentityID:    external.Subject,
		Email:         external.Email,
		EmailVerified: external.EmailVerified,
		Username:      external.Username,
		Name:          external.Name,
		AvatarURL:     external.AvatarURL,
	}, nil
}
