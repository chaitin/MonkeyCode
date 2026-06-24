package provider

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/google/go-github/v74/github"
	"golang.org/x/oauth2"

	"github.com/chaitin/MonkeyCode/backend/config"
)

type GithubProvider struct {
	httpClient  *http.Client
	apiBaseURL  string
	oauthConfig *oauth2.Config
}

func NewGithub(cfg config.OAuthLoginProviderConfig, serverBaseURL string, httpClient *http.Client) *GithubProvider {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &GithubProvider{
		httpClient: httpClient,
		apiBaseURL: "https://api.github.com/",
		oauthConfig: &oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  oauthCallbackURL(cfg.RedirectURL, serverBaseURL, Github),
			Scopes:       []string{"read:user", "user:email"},
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://github.com/login/oauth/authorize",
				TokenURL: "https://github.com/login/oauth/access_token",
			},
		},
	}
}

func (p *GithubProvider) Name() Name {
	return Github
}

func (p *GithubProvider) AuthCodeURL(state, _ string) string {
	return p.oauthConfig.AuthCodeURL(state)
}

func (p *GithubProvider) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	ctx = context.WithValue(ctx, oauth2.HTTPClient, p.httpClient)
	return p.oauthConfig.Exchange(ctx, code)
}

func (p *GithubProvider) User(ctx context.Context, token *oauth2.Token, _ string) (*ExternalUser, error) {
	if token == nil || token.AccessToken == "" {
		return nil, errors.New("github access token is required")
	}
	client := github.NewClient(oauth2.NewClient(ctx, oauth2.StaticTokenSource(token)))
	if p.apiBaseURL != "" && p.apiBaseURL != "https://api.github.com/" {
		u, err := url.Parse(p.apiBaseURL)
		if err != nil {
			return nil, err
		}
		client.BaseURL = u
		client.UploadURL = u
	}
	ghUser, _, err := client.Users.Get(ctx, "")
	if err != nil {
		return nil, err
	}
	emails, _, err := client.Users.ListEmails(ctx, nil)
	if err != nil {
		return nil, err
	}
	email := verifiedGithubEmail(emails)
	if email == "" {
		return nil, errors.New("github verified email is required")
	}
	name := ghUser.GetName()
	if name == "" {
		name = ghUser.GetLogin()
	}
	return &ExternalUser{
		Provider:      Github,
		IdentityID:    strconv.FormatInt(ghUser.GetID(), 10),
		Email:         email,
		EmailVerified: true,
		Username:      ghUser.GetLogin(),
		Name:          name,
		AvatarURL:     ghUser.GetAvatarURL(),
	}, nil
}

func verifiedGithubEmail(emails []*github.UserEmail) string {
	for _, email := range emails {
		if email.GetPrimary() && email.GetVerified() && email.GetEmail() != "" {
			return email.GetEmail()
		}
	}
	for _, email := range emails {
		if email.GetVerified() && email.GetEmail() != "" {
			return email.GetEmail()
		}
	}
	return ""
}

func oauthCallbackURL(configured, serverBaseURL string, name Name) string {
	if configured != "" {
		return configured
	}
	return fmt.Sprintf("%s/api/v1/users/oauth/%s/callback", stringsTrimRightSlash(serverBaseURL), name)
}

func stringsTrimRightSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
