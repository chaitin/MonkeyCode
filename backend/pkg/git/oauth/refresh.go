package oauth

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ── Token 响应结构体 ────────────────────────────────────────────

// GitlabTokenResponse GitLab OAuth Token 响应
type GitlabTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	CreatedAt    int64  `json:"created_at"`
	Scope        string `json:"scope"`
}

func (r *GitlabTokenResponse) ExpiresAt() int64 {
	base := r.CreatedAt
	if base <= 0 {
		base = time.Now().Unix()
	}
	return base + int64(r.ExpiresIn)
}

// GiteaTokenResponse Gitea OAuth Token 响应
type GiteaTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

func (r *GiteaTokenResponse) ExpiresAt() int64 {
	return time.Now().Unix() + int64(r.ExpiresIn)
}

// GiteeTokenResponse Gitee OAuth Token 响应
type GiteeTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	CreatedAt    int64  `json:"created_at"`
}

func (r *GiteeTokenResponse) ExpiresAt() int64 {
	if r.CreatedAt > 0 && r.ExpiresIn > 0 {
		return r.CreatedAt + int64(r.ExpiresIn)
	}
	return time.Now().Unix() + int64(r.ExpiresIn)
}

// ── 刷新函数 ────────────────────────────────────────────────────

// RefreshGitlab 刷新 GitLab OAuth access_token
func RefreshGitlab(baseURL, clientID, clientSecret, refreshToken string, proxies ...string) (*GitlabTokenResponse, error) {
	params := url.Values{}
	params.Add("grant_type", "refresh_token")
	params.Add("refresh_token", refreshToken)
	params.Add("client_id", clientID)
	params.Add("client_secret", clientSecret)

	tokenURL := fmt.Sprintf("%s/oauth/token", strings.TrimSuffix(baseURL, "/"))

	result, err := fetchWithProxyAndBody[GitlabTokenResponse](
		http.MethodPost, tokenURL,
		map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		strings.NewReader(params.Encode()), proxies...,
	)
	if err != nil {
		return nil, fmt.Errorf("refresh gitlab token: %w", err)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("refreshed gitlab access token is empty")
	}
	return result, nil
}

// RefreshGitea 刷新 Gitea OAuth access_token
func RefreshGitea(baseURL, clientID, clientSecret, refreshToken string, proxies ...string) (*GiteaTokenResponse, error) {
	params := url.Values{}
	params.Add("grant_type", "refresh_token")
	params.Add("refresh_token", refreshToken)
	params.Add("client_id", clientID)
	params.Add("client_secret", clientSecret)

	tokenURL := fmt.Sprintf("%s/login/oauth/access_token", strings.TrimSuffix(baseURL, "/"))

	result, err := fetchWithProxyAndBody[GiteaTokenResponse](
		http.MethodPost, tokenURL,
		map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
		strings.NewReader(params.Encode()), proxies...,
	)
	if err != nil {
		return nil, fmt.Errorf("refresh gitea token: %w", err)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("refreshed gitea access token is empty")
	}
	return result, nil
}

// CodeupTokenResponse 阿里云云效 OAuth Token 响应
//
// ⚠️ 当前为占位实现，云效 OAuth 接入尚未启用。
// 云效官方 OpenAPI 的 CreateOAuthToken（POST /login/oauth/create）目前处于"内测中，
// 暂不支持使用"状态，且响应中不包含 refresh_token / expires_in 字段，与标准 OAuth2
// 刷新模型不兼容。等云效放开公网接入并补齐字段后再启用整条链路。
//
// 在此之前，codeup 一律走 PAT 模式：identity.AccessToken 直接存用户填写的 PAT。
type CodeupTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

func (r *CodeupTokenResponse) ExpiresAt() int64 {
	return time.Now().Unix() + int64(r.ExpiresIn)
}

// RefreshCodeup 刷新云效 OAuth access_token
//
// ⚠️ 暂未启用：云效 OAuth 接口尚在内测，且其响应不返回 refresh_token，本函数实际不会
// 被走通。保留实现是为了 token.go 里的 case consts.GitPlatformCodeup 编译通过；待云效
// 放开公网接入后再回头调整。
//
// 默认 token endpoint 走阿里云账号通用网关：https://account.aliyun.com/oauth2/v1/token
// 如有定制（如专有云）可通过 tokenURL 显式覆盖
func RefreshCodeup(tokenURL, clientID, clientSecret, refreshToken string, proxies ...string) (*CodeupTokenResponse, error) {
	if tokenURL == "" {
		tokenURL = "https://account.aliyun.com/oauth2/v1/token"
	}
	params := url.Values{}
	params.Add("grant_type", "refresh_token")
	params.Add("refresh_token", refreshToken)
	params.Add("client_id", clientID)
	params.Add("client_secret", clientSecret)

	result, err := fetchWithProxyAndBody[CodeupTokenResponse](
		http.MethodPost, tokenURL,
		map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
		strings.NewReader(params.Encode()), proxies...,
	)
	if err != nil {
		return nil, fmt.Errorf("refresh codeup token: %w", err)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("refreshed codeup access token is empty")
	}
	return result, nil
}

// CnbTokenResponse CNB (cnb.cool) OAuth Token 响应
//
// CNB 走标准 OAuth2: access_token 8h 有效, refresh_token 180d 有效。
type CnbTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

func (r *CnbTokenResponse) ExpiresAt() int64 {
	return time.Now().Unix() + int64(r.ExpiresIn)
}

// RefreshCnb 刷新 CNB OAuth access_token
//
// POST {webBaseURL}/oauth2/token
// Header: Authorization: Basic b64(client_id:client_secret)
// Body:   grant_type=refresh_token&refresh_token=<token>
//
// webBaseURL 留空默认 https://cnb.cool
func RefreshCnb(webBaseURL, clientID, clientSecret, refreshToken string, proxies ...string) (*CnbTokenResponse, error) {
	if webBaseURL == "" {
		webBaseURL = "https://cnb.cool"
	}
	tokenURL := strings.TrimSuffix(webBaseURL, "/") + "/oauth2/token"

	params := url.Values{}
	params.Add("grant_type", "refresh_token")
	params.Add("refresh_token", refreshToken)

	basic := base64.StdEncoding.EncodeToString([]byte(clientID + ":" + clientSecret))
	result, err := fetchWithProxyAndBody[CnbTokenResponse](
		http.MethodPost, tokenURL,
		map[string]string{
			"Content-Type":  "application/x-www-form-urlencoded",
			"Accept":        "application/json",
			"Authorization": "Basic " + basic,
		},
		strings.NewReader(params.Encode()), proxies...,
	)
	if err != nil {
		return nil, fmt.Errorf("refresh cnb token: %w", err)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("refreshed cnb access token is empty")
	}
	return result, nil
}

// ExchangeCnbCode 用授权码换 access_token + refresh_token
//
// 同 RefreshCnb 走 POST {webBaseURL}/oauth2/token, 区别仅在 form 内容。
func ExchangeCnbCode(webBaseURL, clientID, clientSecret, code, redirectURI string, proxies ...string) (*CnbTokenResponse, error) {
	if webBaseURL == "" {
		webBaseURL = "https://cnb.cool"
	}
	tokenURL := strings.TrimSuffix(webBaseURL, "/") + "/oauth2/token"

	params := url.Values{}
	params.Add("grant_type", "authorization_code")
	params.Add("code", code)
	if redirectURI != "" {
		params.Add("redirect_uri", redirectURI)
	}

	basic := base64.StdEncoding.EncodeToString([]byte(clientID + ":" + clientSecret))
	result, err := fetchWithProxyAndBody[CnbTokenResponse](
		http.MethodPost, tokenURL,
		map[string]string{
			"Content-Type":  "application/x-www-form-urlencoded",
			"Accept":        "application/json",
			"Authorization": "Basic " + basic,
		},
		strings.NewReader(params.Encode()), proxies...,
	)
	if err != nil {
		return nil, fmt.Errorf("exchange cnb code: %w", err)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("exchanged cnb access token is empty")
	}
	return result, nil
}

// RefreshGitee 刷新 Gitee OAuth access_token（无需 client 凭证）
func RefreshGitee(refreshToken string) (*GiteeTokenResponse, error) {
	params := url.Values{}
	params.Add("grant_type", "refresh_token")
	params.Add("refresh_token", refreshToken)

	result, err := fetchWithProxyAndBody[GiteeTokenResponse](
		http.MethodPost, "https://gitee.com/oauth/token",
		map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		strings.NewReader(params.Encode()),
	)
	if err != nil {
		return nil, fmt.Errorf("refresh gitee token: %w", err)
	}
	if result.AccessToken == "" {
		return nil, fmt.Errorf("refreshed gitee access token is empty")
	}
	return result, nil
}
