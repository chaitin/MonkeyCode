package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type OAuthConnection struct {
	ID               string   `json:"id"`
	Provider         string   `json:"provider"`
	Name             string   `json:"name"`
	ClientID         string   `json:"client_id"`
	ClientSecret     string   `json:"client_secret"`
	IssuerURL        string   `json:"issuer_url,omitempty"`
	AuthorizationURL string   `json:"authorization_url,omitempty"`
	TokenURL         string   `json:"token_url,omitempty"`
	UserInfoURL      string   `json:"userinfo_url,omitempty"`
	Scopes           []string `json:"scopes,omitempty"`
	Enabled          bool     `json:"enabled"`
}

type authenticationSettings struct {
	RegistrationEnabled bool              `json:"registration_enabled"`
	OAuthConnections    []OAuthConnection `json:"oauth_connections"`
}

type providerMetadata struct {
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserInfoEndpoint      string `json:"userinfo_endpoint"`
}

type upstreamProfile struct {
	Provider  string
	Issuer    string
	Subject   string
	Username  string
	Name      string
	Email     string
	AvatarURL string
}

func (s *Service) connections(ctx context.Context) ([]OAuthConnection, error) {
	value, err := s.settings.GetValue(ctx, "authentication")
	if err != nil {
		return nil, err
	}
	var settings authenticationSettings
	if err := json.Unmarshal(value, &settings); err != nil {
		return nil, fmt.Errorf("解析认证设置: %w", err)
	}
	connections := make([]OAuthConnection, 0, len(settings.OAuthConnections))
	for _, connection := range settings.OAuthConnections {
		if connection.Enabled {
			connections = append(connections, connection)
		}
	}
	return connections, nil
}

func (s *Service) registrationEnabled(ctx context.Context) bool {
	value, err := s.settings.GetValue(ctx, "authentication")
	if err != nil {
		return false
	}
	var settings authenticationSettings
	return json.Unmarshal(value, &settings) == nil && settings.RegistrationEnabled
}

func (s *Service) connection(ctx context.Context, id string) (OAuthConnection, error) {
	connections, err := s.connections(ctx)
	if err != nil {
		return OAuthConnection{}, err
	}
	for _, connection := range connections {
		if connection.ID == id {
			return connection, nil
		}
	}
	return OAuthConnection{}, ErrNotFound
}

func (s *Service) providerURLs(ctx context.Context, connection OAuthConnection) (providerMetadata, error) {
	metadata := providerMetadata{
		AuthorizationEndpoint: connection.AuthorizationURL,
		TokenEndpoint:         connection.TokenURL,
		UserInfoEndpoint:      connection.UserInfoURL,
	}
	if metadata.AuthorizationEndpoint != "" && metadata.TokenEndpoint != "" && metadata.UserInfoEndpoint != "" {
		return metadata, nil
	}

	switch connection.Provider {
	case "github":
		metadata = providerMetadata{"https://github.com/login/oauth/authorize", "https://github.com/login/oauth/access_token", "https://api.github.com/user"}
	case "google":
		metadata = providerMetadata{"https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", "https://openidconnect.googleapis.com/v1/userinfo"}
	case "microsoft":
		metadata = providerMetadata{"https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "https://login.microsoftonline.com/common/oauth2/v2.0/token", "https://graph.microsoft.com/oidc/userinfo"}
	case "gitlab":
		metadata = providerMetadata{"https://gitlab.com/oauth/authorize", "https://gitlab.com/oauth/token", "https://gitlab.com/api/v4/user"}
	case "oidc":
		if connection.IssuerURL == "" {
			return providerMetadata{}, errors.New("OIDC issuer_url 不能为空")
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(connection.IssuerURL, "/")+"/.well-known/openid-configuration", nil)
		if err != nil {
			return providerMetadata{}, err
		}
		response, err := s.client.Do(request)
		if err != nil {
			return providerMetadata{}, fmt.Errorf("读取 OIDC 元数据: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return providerMetadata{}, fmt.Errorf("读取 OIDC 元数据: HTTP %d", response.StatusCode)
		}
		if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&metadata); err != nil {
			return providerMetadata{}, fmt.Errorf("解析 OIDC 元数据: %w", err)
		}
	default:
		return providerMetadata{}, errors.New("不支持的 OAuth 提供方")
	}
	return metadata, nil
}

func (s *Service) upstreamAuthorizeURL(ctx context.Context, connection OAuthConnection, state string) (string, error) {
	metadata, err := s.providerURLs(ctx, connection)
	if err != nil {
		return "", err
	}
	endpoint, err := url.Parse(metadata.AuthorizationEndpoint)
	if err != nil {
		return "", err
	}
	scopes := connection.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "profile", "email"}
		if connection.Provider == "github" {
			scopes = []string{"read:user", "user:email"}
		}
	}
	query := endpoint.Query()
	query.Set("response_type", "code")
	query.Set("client_id", connection.ClientID)
	query.Set("redirect_uri", s.publicURL+"/api/auth/v1/oauth/callback")
	query.Set("scope", strings.Join(scopes, " "))
	query.Set("state", state)
	endpoint.RawQuery = query.Encode()
	return endpoint.String(), nil
}

func (s *Service) exchangeUpstream(ctx context.Context, connection OAuthConnection, code string) (upstreamProfile, error) {
	metadata, err := s.providerURLs(ctx, connection)
	if err != nil {
		return upstreamProfile{}, err
	}
	values := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {connection.ClientID},
		"client_secret": {connection.ClientSecret},
		"code":          {code},
		"redirect_uri":  {s.publicURL + "/api/auth/v1/oauth/callback"},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, metadata.TokenEndpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return upstreamProfile{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.client.Do(request)
	if err != nil {
		return upstreamProfile{}, fmt.Errorf("交换上游令牌: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return upstreamProfile{}, fmt.Errorf("交换上游令牌: HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var tokenResponse struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&tokenResponse); err != nil || tokenResponse.AccessToken == "" {
		return upstreamProfile{}, errors.New("上游未返回 access_token")
	}

	request, err = http.NewRequestWithContext(ctx, http.MethodGet, metadata.UserInfoEndpoint, nil)
	if err != nil {
		return upstreamProfile{}, err
	}
	request.Header.Set("Authorization", "Bearer "+tokenResponse.AccessToken)
	request.Header.Set("Accept", "application/json")
	response, err = s.client.Do(request)
	if err != nil {
		return upstreamProfile{}, fmt.Errorf("读取上游用户: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return upstreamProfile{}, fmt.Errorf("读取上游用户: HTTP %d", response.StatusCode)
	}
	var raw map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&raw); err != nil {
		return upstreamProfile{}, err
	}
	profile := normalizeProfile(connection, raw)
	if profile.Subject == "" {
		return upstreamProfile{}, errors.New("上游用户缺少 subject")
	}
	return profile, nil
}

func normalizeProfile(connection OAuthConnection, raw map[string]any) upstreamProfile {
	issuer := connection.IssuerURL
	if issuer == "" {
		issuer = connection.Provider
	}
	profile := upstreamProfile{
		Provider:  connection.Provider,
		Issuer:    issuer,
		Subject:   stringValue(raw, "sub", "id"),
		Username:  stringValue(raw, "preferred_username", "login", "username", "userPrincipalName"),
		Name:      stringValue(raw, "name", "displayName", "login", "username"),
		Email:     stringValue(raw, "email", "mail", "userPrincipalName"),
		AvatarURL: stringValue(raw, "picture", "avatar_url"),
	}
	if profile.Name == "" {
		profile.Name = profile.Username
	}
	return profile
}

func stringValue(values map[string]any, keys ...string) string {
	for _, key := range keys {
		switch value := values[key].(type) {
		case string:
			if value != "" {
				return value
			}
		case float64:
			return strconv.FormatInt(int64(value), 10)
		case json.Number:
			return value.String()
		}
	}
	return ""
}
