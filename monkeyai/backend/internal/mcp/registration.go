package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc/connector"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

// 调用方持有连接行锁，确保并发授权复用同一个客户端。
func (s *Service) ensureOAuthClient(ctx context.Context, tx pgx.Tx, c resource.Object, redirect string) error {
	o := oauthSettings(c)
	if o.ClientID != "" && !o.clientSecretExpired() {
		return nil
	}
	registered, err := registerOAuthClient(ctx, o, redirect)
	if err != nil {
		return &resource.Error{Status: 502, Code: "oauth_registration_failed", Message: "OAuth 动态客户端注册失败，请检查注册端点或手动配置 Client ID"}
	}
	revision := c.Int("config_revision")
	if o.ClientID != "" {
		// 更换客户端后，旧凭证及未完成授权不能使用新客户端的密钥。
		revision++
		if err = sqlc.New(tx).InvalidateConnectorTools(ctx, c.String("id")); err != nil {
			return err
		}
	}
	o.ClientID, o.TokenAuthMethod, o.ClientSecretExpiresAt = registered.ClientID, registered.Method, registered.SecretExpires
	data, _ := json.Marshal(resource.Object{"id": c.String("id"), "oauth_config": o, "oauth_client_secret": registered.Secret, "config_revision": revision})
	if err = connector.New(tx).UpdateResource(ctx, data); err != nil {
		return err
	}
	c["oauth_config"], c["oauth_client_secret"], c["config_revision"] = o, registered.Secret, float64(revision)
	return nil
}

type oauthRegistration struct {
	ClientID      string   `json:"client_id"`
	Secret        string   `json:"client_secret"`
	Method        string   `json:"token_endpoint_auth_method"`
	Redirects     []string `json:"redirect_uris"`
	SecretExpires int64    `json:"client_secret_expires_at"`
	Error         string   `json:"error"`
}

func (o oauthConfig) clientSecretExpired() bool {
	return o.TokenAuthMethod != "none" && o.ClientSecretExpiresAt > 0 && o.ClientSecretExpiresAt <= time.Now().Unix()
}

func registerOAuthClient(ctx context.Context, o oauthConfig, redirect string) (oauthRegistration, error) {
	fail := func() (oauthRegistration, error) {
		return oauthRegistration{}, fmt.Errorf("OAuth 动态客户端注册响应无效")
	}
	if !validURL(o.RegistrationURL) || !validURL(redirect) {
		return fail()
	}
	method := o.TokenAuthMethod
	if method == "" {
		method = "none"
	}
	body := resource.Object{
		"client_name": "MonkeyAI", "redirect_uris": []string{redirect},
		"grant_types":    []string{"authorization_code", "refresh_token"},
		"response_types": []string{"code"}, "token_endpoint_auth_method": method,
	}
	if o.Scopes != "" {
		body["scope"] = o.Scopes
	}
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.RegistrationURL, bytes.NewReader(data))
	if err != nil {
		return fail()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	h := client()
	defer h.CloseIdleConnections()
	resp, err := h.Do(req)
	if err != nil {
		return fail()
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return fail()
	}
	data, err = io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return fail()
	}
	var result oauthRegistration
	if json.Unmarshal(data, &result) != nil || result.Error != "" || strings.TrimSpace(result.ClientID) == "" || strings.ContainsAny(result.ClientID+result.Secret, "\r\n") {
		return fail()
	}
	// RFC 7591 规定省略认证方式时默认为 client_secret_basic。
	if result.Method == "" {
		result.Method = "client_secret_basic"
	}
	if result.Method != "none" && result.Method != "client_secret_post" && result.Method != "client_secret_basic" {
		return fail()
	}
	if result.Method != "none" && (result.Secret == "" || (result.SecretExpires != 0 && result.SecretExpires <= time.Now().Unix())) {
		return fail()
	}
	if len(result.Redirects) != 1 || result.Redirects[0] != redirect {
		return fail()
	}
	if result.Method == "none" {
		result.Secret, result.SecretExpires = "", 0
	}
	return result, nil
}
