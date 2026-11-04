package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

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
	h, err := s.clientFor(ctx, c.String("proxy_id"))
	if err != nil {
		return err
	}
	setConnectorTimeout(h, c.Int("timeout_ms"))
	if o.Mode == "dynamic" && o.ClientID == "" {
		requestedScopes := o.Scopes
		o, err = discoverOAuthWithClient(ctx, c.String("url"), h)
		if err != nil {
			logging.Event(ctx, slog.Default(), slog.LevelWarn, "mcp.operation.warn", "OAuth 自动发现失败", "module", "mcp", "operation", "ensureOAuthClient", "connector_id", c.String("id"), "operation", "discovery", "error", err)
			return upstreamFailure(err, "oauth_discovery_failed")
		}
		if requestedScopes != "" {
			o.Scopes = requestedScopes
		}
	}
	registered, err := registerOAuthClientWithClient(ctx, o, redirect, h)
	if err != nil {
		logging.Event(ctx, slog.Default(), slog.LevelWarn, "mcp.operation.warn", "OAuth 客户端注册失败", "module", "mcp", "operation", "ensureOAuthClient", "connector_id", c.String("id"), "operation", "registration", "error", err)
		return upstreamFailure(err, "oauth_registration_failed")
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
	data, err := json.Marshal(resource.Object{"id": c.String("id"), "oauth_config": o, "oauth_client_secret": registered.Secret, "config_revision": revision})
	if err != nil {
		return fmt.Errorf("编码 OAuth 客户端配置: %w", err)
	}
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
	return registerOAuthClientWithClient(ctx, o, redirect, client())
}

func registerOAuthClientWithClient(ctx context.Context, o oauthConfig, redirect string, h *http.Client) (oauthRegistration, error) {
	fail := func() (oauthRegistration, error) {
		return oauthRegistration{}, failure("oauth_registration_response_invalid", nil)
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
	data, err := json.Marshal(body)
	if err != nil {
		return oauthRegistration{}, fmt.Errorf("编码 OAuth 注册请求: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.RegistrationURL, bytes.NewReader(data))
	if err != nil {
		slog.WarnContext(ctx, "操作失败", "module", "mcp", "operation", "registerOAuthClientWithClient", "error", err)
		return fail()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	defer h.CloseIdleConnections()
	resp, err := h.Do(req)
	if err != nil {
		return oauthRegistration{}, upstreamFailure(err, "oauth_registration_failed")
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			logging.Event(ctx, slog.Default(), slog.LevelWarn, "mcp.operation.warn", "关闭 OAuth 注册响应失败", "module", "mcp", "operation", "registerOAuthClientWithClient", "operation", "register_client", "failure", err)
		}
	}()
	if resp.StatusCode != http.StatusCreated {
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed {
			return oauthRegistration{}, failure("oauth_registration_unsupported", remoteStatus(resp.StatusCode))
		}
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 || resp.StatusCode >= 300 && resp.StatusCode < 400 {
			return oauthRegistration{}, upstreamFailure(remoteStatus(resp.StatusCode), "oauth_registration_failed")
		}
		return oauthRegistration{}, failure("oauth_registration_rejected", remoteStatus(resp.StatusCode))
	}
	data, err = io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		if err != nil {
			return oauthRegistration{}, upstreamFailure(err, "oauth_registration_response_invalid")
		}
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
