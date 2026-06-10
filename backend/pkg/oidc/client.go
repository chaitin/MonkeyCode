package oidc

import (
	"context"
	"errors"
	"net/http"
	"strings"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type Client struct {
	httpClient *http.Client
}

type Discovery struct {
	Issuer                string
	AuthorizationEndpoint string
	TokenEndpoint         string
	UserinfoEndpoint      string
	provider              *gooidc.Provider
}

type Config struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Scopes       []string
}

func NewClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{httpClient: httpClient}
}

func NormalizeIssuer(issuer string) string {
	return strings.TrimRight(strings.TrimSpace(issuer), "/")
}

func CleanIssuer(issuer string) string {
	return strings.TrimSpace(issuer)
}

func SplitScopes(scopes string) []string {
	fields := strings.Fields(scopes)
	if len(fields) == 0 {
		return []string{"openid", "email", "profile"}
	}
	return fields
}

func (c *Client) Discover(ctx context.Context, issuer string) (*Discovery, error) {
	issuer = CleanIssuer(issuer)
	if issuer == "" {
		return nil, errors.New("issuer is required")
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.httpClient)
	provider, err := gooidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, err
	}
	endpoint := provider.Endpoint()
	var claims struct {
		Issuer           string `json:"issuer"`
		UserinfoEndpoint string `json:"userinfo_endpoint"`
	}
	if err := provider.Claims(&claims); err != nil {
		return nil, err
	}
	if CleanIssuer(claims.Issuer) != issuer {
		return nil, errors.New("issuer mismatch")
	}
	if endpoint.AuthURL == "" || endpoint.TokenURL == "" {
		return nil, errors.New("discovery missing required endpoint")
	}
	return &Discovery{
		Issuer:                issuer,
		AuthorizationEndpoint: endpoint.AuthURL,
		TokenEndpoint:         endpoint.TokenURL,
		UserinfoEndpoint:      claims.UserinfoEndpoint,
		provider:              provider,
	}, nil
}

func OAuthConfig(doc *Discovery, cfg Config) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURL,
		Scopes:       cfg.Scopes,
		Endpoint: oauth2.Endpoint{
			AuthURL:  doc.AuthorizationEndpoint,
			TokenURL: doc.TokenEndpoint,
		},
	}
}

func IdentityID(issuer, subject string) string {
	return NormalizeIssuer(issuer) + "#" + subject
}

func ValidateExternalUser(u *domain.OIDCExternalUser) error {
	if u == nil || u.Subject == "" {
		return errors.New("subject is required")
	}
	if strings.TrimSpace(u.Email) == "" {
		return errors.New("email is required")
	}
	if !u.EmailVerified {
		return errors.New("email is not verified")
	}
	return nil
}

func (c *Client) VerifyIDToken(ctx context.Context, doc *Discovery, cfg Config, rawIDToken string, nonce string) (*domain.OIDCExternalUser, error) {
	if doc == nil || doc.provider == nil {
		return nil, errors.New("provider is required")
	}
	verifier := doc.provider.Verifier(&gooidc.Config{ClientID: cfg.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, err
	}
	var claims struct {
		Nonce             string `json:"nonce"`
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
		Picture           string `json:"picture"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, err
	}
	if nonce != "" && claims.Nonce != nonce {
		return nil, errors.New("nonce mismatch")
	}
	return &domain.OIDCExternalUser{
		Issuer:        NormalizeIssuer(idToken.Issuer),
		Subject:       idToken.Subject,
		Email:         strings.TrimSpace(strings.ToLower(claims.Email)),
		EmailVerified: claims.EmailVerified,
		Name:          claims.Name,
		Username:      claims.PreferredUsername,
		AvatarURL:     claims.Picture,
	}, nil
}

func (c *Client) UserInfo(ctx context.Context, doc *Discovery, tokenSource oauth2.TokenSource, external *domain.OIDCExternalUser) (*domain.OIDCExternalUser, error) {
	if doc == nil || doc.provider == nil || tokenSource == nil {
		return external, nil
	}
	info, err := doc.provider.UserInfo(ctx, tokenSource)
	if err != nil {
		return external, err
	}
	var claims struct {
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
		Picture           string `json:"picture"`
	}
	if err := info.Claims(&claims); err != nil {
		return external, err
	}
	if external.Email == "" {
		external.Email = strings.TrimSpace(strings.ToLower(claims.Email))
		external.EmailVerified = claims.EmailVerified
	}
	if external.Name == "" {
		external.Name = claims.Name
	}
	if external.Username == "" {
		external.Username = claims.PreferredUsername
	}
	if external.AvatarURL == "" {
		external.AvatarURL = claims.Picture
	}
	return external, nil
}
