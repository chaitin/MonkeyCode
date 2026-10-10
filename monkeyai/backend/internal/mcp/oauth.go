package mcp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type oauthConfig struct {
	Mode                  string `json:"mode,omitempty"`
	Resource              string `json:"resource,omitempty"`
	AuthorizationURL      string `json:"authorization_url"`
	TokenURL              string `json:"token_url"`
	ClientID              string `json:"client_id"`
	Scopes                string `json:"scopes"`
	RegistrationURL       string `json:"registration_url,omitempty"`
	TokenAuthMethod       string `json:"token_endpoint_auth_method,omitempty"`
	ClientSecretExpiresAt int64  `json:"client_secret_expires_at,omitempty"`
}

func oauthSettings(c resource.Object) oauthConfig {
	b, err := json.Marshal(c["oauth_config"])
	if err != nil {
		if unsupported, ok := errors.AsType[*json.UnsupportedTypeError](err); ok {
			slog.Error("编码 OAuth 配置失败", "connector_id", c.String("id"), "operation", "encode_config", "error", unsupported)
		} else {
			// 自定义 JSON 错误可能回显配置中的客户端密钥。
			slog.Error("编码 OAuth 配置失败", "connector_id", c.String("id"), "operation", "encode_config", "failure_reason", "invalid_config_encoding")
		}
		return oauthConfig{}
	}
	var o oauthConfig
	if err := json.Unmarshal(b, &o); err != nil {
		slog.Error("解析 OAuth 配置失败", "connector_id", c.String("id"), "operation", "decode_config", "failure_reason", "invalid_config_format")
		return oauthConfig{}
	}
	return o
}
func token() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("生成 OAuth 随机数: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
func hash(value string) string { v := sha256.Sum256([]byte(value)); return hex.EncodeToString(v[:]) }
func (s *Service) callbackURL(id string) string {
	return s.PublicURL + "/oauth/connectors/" + id + "/callback"
}
func (s *Service) authorize(w http.ResponseWriter, r *http.Request, admin bool) {
	ctx := r.Context()
	u, _ := identity.UserFromContext(ctx)
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollbackMCP(ctx, tx, chi.URLParam(r, "id"), chi.URLParam(r, "credentialID"), "authorize")
	c, err := s.lockConnector(ctx, tx, chi.URLParam(r, "id"), u.ID, admin)
	if err == nil {
		err = manageCredential(c, admin)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if c.String("authorization_method") != "oauth" {
		resource.Fail(w, resource.Invalid("此连接不支持 OAuth 授权"))
		return
	}
	data := resource.Object{"id": resource.ID(), "connector_id": c.String("id"), "user_id": u.ID}
	if id := chi.URLParam(r, "credentialID"); id != "" {
		cred, err := s.Credential(ctx, tx, c, u.ID, id)
		if err == nil {
			_, err = sqlc.New(tx).LockCredential(ctx, id)
		}
		if err == nil {
			err = matchCredential(r, cred)
		}
		if err != nil {
			resource.Fail(w, err)
			return
		}
		data["credential_id"], data["credential_revision"], data["name"] = id, cred.Int("revision"), cred.String("name")
	} else {
		var in struct {
			Name string `json:"name"`
		}
		if err = resource.Decode(w, r, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		data["name"], err = credentialName(in.Name)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if admin {
			_, err = sqlc.New(tx).GetCentralCredential(ctx, c.String("id"))
			if err == nil {
				resource.Fail(w, resource.Invalid("已存在集中凭证，请选择该凭证重新授权"))
				return
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				resource.Fail(w, err)
				return
			}
		}
	}
	state, err := token()
	if err != nil {
		resource.Fail(w, err)
		return
	}
	verifier, err := token()
	if err != nil {
		resource.Fail(w, err)
		return
	}
	redirect := s.callbackURL(c.String("id"))
	if err = s.ensureOAuthClient(ctx, tx, c, redirect); err != nil {
		resource.Fail(w, err)
		return
	}
	data["config_revision"] = c.Int("config_revision")
	data["state_hash"], data["verifier"], data["redirect_uri"] = hash(state), verifier, redirect
	b, err := json.Marshal(data)
	if err != nil {
		resource.Fail(w, fmt.Errorf("编码 OAuth 授权请求: %w", err))
		return
	}
	request, err := resource.DecodeObject(sqlc.New(tx).CreateOAuthRequest(ctx, b))
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	o := oauthSettings(c)
	target, err := url.Parse(o.AuthorizationURL)
	if err != nil || target == nil || target.Scheme == "" || target.Host == "" {
		resource.Fail(w, resource.Invalid("OAuth 授权地址无效"))
		return
	}
	q := target.Query()
	q.Set("response_type", "code")
	q.Set("client_id", o.ClientID)
	q.Set("redirect_uri", redirect)
	q.Set("state", state)
	q.Set("scope", o.Scopes)
	if o.Resource != "" {
		q.Set("resource", o.Resource)
	}
	challenge := sha256.Sum256([]byte(verifier))
	q.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	q.Set("code_challenge_method", "S256")
	target.RawQuery = q.Encode()
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(w, 200, resource.Object{"id": request["id"], "authorization_url": target.String(), "expires_at": request["expires_at"]})
}
func (s *Service) authorizationStatus(w http.ResponseWriter, r *http.Request) {
	u, _ := identity.UserFromContext(r.Context())
	out, err := resource.DecodeObject(sqlc.New(s.Store.Pool).GetOAuthStatus(r.Context(), sqlc.GetOAuthStatusParams{ID: chi.URLParam(r, "id"), UserID: u.ID}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(w, 200, out)
}
func (s *Service) oauthContext(ctx context.Context, tx pgx.Tx, request resource.Object) (resource.Object, error) {
	c, err := resource.DecodeObject(sqlc.New(tx).LockConnector(ctx, request.String("connector_id")))
	if err != nil {
		return nil, err
	}
	if c.Int("config_revision") != request.Int("config_revision") || c.String("authorization_method") != "oauth" {
		return nil, resource.Conflict
	}
	admin := c.String("authorization_mode") == "centralized"
	c, err = s.Connector(ctx, tx, c.String("id"), request.String("user_id"), admin)
	if err != nil {
		return nil, err
	}
	if err := manageCredential(c, admin); err != nil {
		return nil, err
	}
	if request["credential_revision"] != nil {
		cred, err := s.Credential(ctx, tx, c, request.String("user_id"), request.String("credential_id"))
		if err != nil {
			return nil, err
		}
		if _, err := sqlc.New(tx).LockCredential(ctx, cred.String("id")); err != nil {
			return nil, err
		}
		if cred.Int("revision") != request.Int("credential_revision") {
			return nil, resource.Conflict
		}
	}
	return c, nil
}
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	ctx := r.Context()
	id, state := chi.URLParam(r, "id"), r.URL.Query().Get("state")
	if id == "" || state == "" {
		resource.Fail(w, resource.Invalid("授权事务无效或已使用"))
		return
	}
	request, err := resource.DecodeObject(sqlc.New(s.Store.Pool).ConsumeOAuthRequest(ctx, sqlc.ConsumeOAuthRequestParams{StateHash: hash(state), ConnectorID: id}))
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.ErrorContext(ctx, "消费 OAuth 授权事务失败", "connector_id", id, "operation", "consume", "failure", safeMCPFailure(err))
		}
		resource.Fail(w, resource.Invalid("授权事务无效或已使用"))
		return
	}
	success := false
	defer func() {
		if success {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if _, err := sqlc.New(s.Store.Pool).FinishOAuthRequest(cleanup, sqlc.FinishOAuthRequestParams{ID: request.String("id"), Status: "failed", CredentialID: ""}); err != nil {
			slog.ErrorContext(cleanup, "标记 OAuth 授权失败事务失败", "connector_id", id, "operation", "finish_failed", "error", err)
		}
	}()
	if r.URL.Query().Get("error") != "" || r.URL.Query().Get("code") == "" {
		resource.Fail(w, resource.Invalid("授权已取消或缺少授权码"))
		return
	}
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	c, err := s.oauthContext(ctx, tx, request)
	if rollbackErr := tx.Rollback(ctx); rollbackErr != nil {
		if err == nil {
			err = rollbackErr
		} else {
			slog.WarnContext(ctx, "释放 OAuth 授权事务失败", "connector_id", id, "operation", "rollback", "error", rollbackErr)
		}
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	result, err := exchange(ctx, c, url.Values{"grant_type": {"authorization_code"}, "code": {r.URL.Query().Get("code")}, "redirect_uri": {request.String("redirect_uri")}, "code_verifier": {request.String("verifier")}})
	if err != nil {
		slog.WarnContext(ctx, "OAuth Token 交换失败", "connector_id", id, "operation", "exchange", "failure", safeMCPFailure(err))
		resource.Fail(w, &resource.Error{Status: 502, Code: "oauth_exchange_failed", Message: "OAuth Token 交换失败，请重新发起授权"})
		return
	}
	tx, err = s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollbackMCP(ctx, tx, id, request.String("credential_id"), "callback")
	c, err = s.oauthContext(ctx, tx, request)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	user := request.String("user_id")
	if c.String("authorization_mode") == "centralized" {
		user = ""
	}
	credential := request.String("credential_id")
	create := request["credential_revision"] == nil
	if create {
		credential = resource.ID()
	}
	data := resource.Object{"id": credential, "connector_id": id, "user_id": user, "name": request.String("name"),
		"http_headers": resource.Object{}, "oauth_access_token": result.Access, "oauth_refresh_token": result.Refresh,
		"oauth_expires_at": result.Expires, "config_revision": c.Int("config_revision"), "auth_change": true}
	b, err := json.Marshal(data)
	if err != nil {
		resource.Fail(w, fmt.Errorf("编码 OAuth 凭证: %w", err))
		return
	}
	queries := sqlc.New(tx)
	var cred resource.Object
	if create {
		cred, err = resource.DecodeObject(queries.CreateCredential(ctx, b))
	} else {
		cred, err = resource.DecodeObject(queries.UpdateCredential(ctx, b))
	}
	if err == nil {
		_, err = queries.InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: id, CredentialID: credential})
	}
	if err == nil {
		var rows int64
		rows, err = queries.FinishOAuthRequest(ctx, sqlc.FinishOAuthRequestParams{ID: request.String("id"), Status: "processing", CredentialID: credential})
		if err == nil && rows != 1 {
			err = resource.Conflict
		}
	}
	if err == nil {
		err = resource.Audit(ctx, tx, request.String("user_id"), "connector_credential", credential, "oauth_authorize")
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	check, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
	defer cancel()
	_, testErr := s.testConnection(check, c, cred, request.String("user_id"), c.String("authorization_mode") == "centralized")
	if testErr != nil {
		slog.WarnContext(check, "OAuth 授权后连接测试失败", "connector_id", id, "credential_id", credential, "failure", safeMCPFailure(testErr))
	}
	finish, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	rows, err := sqlc.New(s.Store.Pool).FinishOAuthRequest(finish, sqlc.FinishOAuthRequestParams{ID: request.String("id"), Status: "succeeded", CredentialID: credential})
	if err == nil && rows != 1 {
		err = resource.Conflict
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	success = true
	message := "授权成功，已自动测试连接并更新工具列表，请返回 MonkeyAI。"
	if testErr != nil {
		message = "授权成功，但自动连接测试失败，请返回 MonkeyAI 查看凭证状态并重试连接测试。"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := fmt.Fprintf(w, "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>授权成功</title><p>%s</p></html>", message); err != nil {
		slog.WarnContext(ctx, "写入 OAuth 授权结果失败", "connector_id", id, "credential_id", credential, "failure_reason", "response_write_failed", "error_type", fmt.Sprintf("%T", err))
	}
}

type tokens struct {
	Access, Refresh string
	Expires         *time.Time
}

var invalidGrant = errors.New("OAuth 凭证已失效")

type tokenExchangeError struct {
	reason string
	status int
}

func (e tokenExchangeError) Error() string { return e.reason }

// 上游及回调错误可能携带 URL 查询串、授权码或 Token，仅输出受控分类与状态。
func safeMCPFailure(err error) []any {
	if exchangeErr, ok := errors.AsType[tokenExchangeError](err); ok {
		if exchangeErr.status != 0 {
			return []any{"reason", exchangeErr.reason, "upstream_status", exchangeErr.status}
		}
		return []any{"reason", exchangeErr.reason}
	}
	if failure, ok := errors.AsType[*resource.Error](err); ok {
		return []any{"reason", failure.Code, "status", failure.Status}
	}
	if upstream, ok := errors.AsType[remoteStatus](err); ok {
		return []any{"reason", "upstream_http_error", "upstream_status", int(upstream)}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return []any{"reason", "timeout"}
	}
	if errors.Is(err, context.Canceled) {
		return []any{"reason", "canceled"}
	}
	if network, ok := errors.AsType[net.Error](err); ok {
		return []any{"reason", "network_error", "timeout", network.Timeout()}
	}
	if _, ok := errors.AsType[*url.Error](err); ok {
		return []any{"reason", "transport_error"}
	}
	if databaseErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		return []any{"reason", "database_error", "sqlstate", databaseErr.Code}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return []any{"error", pgx.ErrNoRows}
	}
	return []any{"reason", "internal_error", "error_type", fmt.Sprintf("%T", err)}
}

func exchange(ctx context.Context, c resource.Object, v url.Values) (tokens, error) {
	return exchangeWithProxy(ctx, c, v, http.ProxyFromEnvironment)
}

func exchangeWithProxy(ctx context.Context, c resource.Object, v url.Values, proxy func(*http.Request) (*url.URL, error)) (tokens, error) {
	o := oauthSettings(c)
	if o.clientSecretExpired() {
		return tokens{}, invalidGrant
	}
	v.Set("client_id", o.ClientID)
	if o.Resource != "" {
		v.Set("resource", o.Resource)
	}
	secret := c.String("oauth_client_secret")
	if secret != "" && (o.TokenAuthMethod == "" || o.TokenAuthMethod == "client_secret_post") {
		v.Set("client_secret", secret)
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", o.TokenURL, strings.NewReader(v.Encode()))
	if err != nil {
		return tokens{}, tokenExchangeError{reason: "invalid_token_url"}
	}
	if o.TokenAuthMethod == "client_secret_basic" {
		req.SetBasicAuth(url.QueryEscape(o.ClientID), url.QueryEscape(secret))
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	h, req, err := tokenClient(req, proxy, net.DefaultResolver.LookupNetIP)
	if err != nil {
		return tokens{}, err
	}
	defer h.CloseIdleConnections()
	resp, err := h.Do(req)
	if err != nil {
		return tokens{}, err
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			slog.WarnContext(ctx, "关闭 OAuth Token 响应失败", "operation", "exchange", "failure", safeMCPFailure(err))
		}
	}()
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil {
		return tokens{}, tokenExchangeError{reason: "response_read_error", status: resp.StatusCode}
	}
	if len(data) > 1<<20 {
		return tokens{}, tokenExchangeError{reason: "response_too_large", status: resp.StatusCode}
	}
	var payload struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
		Expires int64  `json:"expires_in"`
		Type    string `json:"token_type"`
		Error   string `json:"error"`
	}
	var form url.Values
	if json.Unmarshal(data, &payload) != nil {
		form, err = url.ParseQuery(string(data))
		if err != nil {
			return tokens{}, tokenExchangeError{reason: "invalid_token_response", status: resp.StatusCode}
		}
		payload.Access = form.Get("access_token")
		payload.Refresh = form.Get("refresh_token")
		payload.Type = form.Get("token_type")
		payload.Error = form.Get("error")
	}
	if resp.StatusCode == 400 && payload.Error == "invalid_grant" {
		return tokens{}, invalidGrant
	}
	if resp.StatusCode != http.StatusOK {
		return tokens{}, tokenExchangeError{reason: "upstream_http_error", status: resp.StatusCode}
	}
	if payload.Error != "" || payload.Access == "" || strings.ContainsAny(payload.Access, "\r\n") || (!strings.EqualFold(payload.Type, "bearer") && payload.Type != "") {
		return tokens{}, tokenExchangeError{reason: "invalid_token_response", status: resp.StatusCode}
	}
	if form != nil {
		if expires := form.Get("expires_in"); expires != "" {
			seconds, err := strconv.ParseInt(expires, 10, 64)
			if err != nil {
				return tokens{}, tokenExchangeError{reason: "invalid_expires_in", status: resp.StatusCode}
			}
			payload.Expires = seconds
		}
	}
	result := tokens{Access: payload.Access, Refresh: payload.Refresh}
	if payload.Expires > 0 {
		expires := time.Now().Add(time.Duration(min(payload.Expires, 31536000)) * time.Second)
		result.Expires = &expires
	}
	return result, nil
}
func (s *Service) refresh(ctx context.Context, c, cred resource.Object) (resource.Object, error) {
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollbackMCP(ctx, tx, c.String("id"), cred.String("id"), "refresh")
	current, err := resource.DecodeObject(sqlc.New(tx).LockConnector(ctx, c.String("id")))
	if err != nil {
		return nil, err
	}
	if current.Int("config_revision") != c.Int("config_revision") {
		return nil, authorizationRequired
	}
	cred, err = resource.DecodeObject(sqlc.New(tx).LockCredential(ctx, cred.String("id")))
	if err != nil {
		return nil, err
	}
	if cred.String("connector_id") != current.String("id") || credentialStatus(current, cred) != "authorized" {
		return nil, authorizationRequired
	}
	if tokenFresh(cred, 30*time.Second) {
		return cred, nil
	}
	if cred.String("oauth_refresh_token") == "" {
		if tokenFresh(cred, 0) {
			return cred, nil
		}
		return nil, authorizationRequired
	}
	result, err := exchange(ctx, current, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {cred.String("oauth_refresh_token")}})
	if errors.Is(err, invalidGrant) {
		if err = sqlc.New(tx).ExpireCredential(ctx, cred.String("id")); err != nil {
			return nil, err
		}
		if _, err = sqlc.New(tx).InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: current.String("id"), CredentialID: cred.String("id")}); err != nil {
			return nil, err
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, err
		}
		return nil, authorizationRequired
	}
	if err != nil {
		slog.WarnContext(ctx, "刷新 OAuth 凭证失败", "connector_id", c.String("id"), "credential_id", cred.String("id"), "operation", "refresh", "failure", safeMCPFailure(err))
		return nil, &resource.Error{Status: 502, Code: "oauth_refresh_failed", Message: "OAuth 刷新暂时失败，请稍后重试"}
	}
	if result.Refresh == "" {
		result.Refresh = cred.String("oauth_refresh_token")
	}
	out, err := resource.DecodeObject(sqlc.New(tx).RefreshCredential(ctx, sqlc.RefreshCredentialParams{ID: cred.String("id"), OauthAccessToken: result.Access, OauthRefreshToken: result.Refresh, OauthExpiresAt: result.Expires}))
	if err != nil {
		return nil, err
	}
	return out, tx.Commit(ctx)
}
func (s *Service) refreshCredentials(ctx context.Context) {
	query, cancel := context.WithTimeout(ctx, 10*time.Second)
	pending, err := sqlc.New(s.Store.Pool).ListExpiringCredentials(query)
	cancel()
	if err != nil {
		if ctx.Err() == nil {
			slog.ErrorContext(ctx, "读取待刷新 Connector 凭证失败", "error", err)
		}
		return
	}
	var workers sync.WaitGroup
	slots := make(chan struct{}, 4)
	for _, item := range pending {
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			workers.Wait()
			return
		}
		workers.Go(func() {
			defer func() { <-slots }()
			refresh, stop := context.WithTimeout(ctx, 30*time.Second)
			defer stop()
			c, err := resource.DecodeObject(item.Connector, nil)
			if err != nil {
				slog.ErrorContext(refresh, "解析待刷新 Connector 数据失败", "operation", "decode_connector", "error", err)
				return
			}
			cred, err := resource.DecodeObject(item.Credential, nil)
			if err != nil {
				slog.ErrorContext(refresh, "解析待刷新凭证数据失败", "connector_id", c.String("id"), "operation", "decode_credential", "error", err)
				return
			}
			if _, err = s.refresh(refresh, c, cred); err != nil && ctx.Err() == nil && !errors.Is(err, authorizationRequired) && !isOAuthRefreshFailure(err) {
				slog.WarnContext(ctx, "Connector OAuth 自动刷新失败", "connector_id", c.String("id"), "credential_id", cred.String("id"), "error", err)
			}
		})
	}
	workers.Wait()
}
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		cleanup, cancel := context.WithTimeout(ctx, 10*time.Second)
		if err := sqlc.New(s.Store.Pool).CleanupOAuthRequests(cleanup); err != nil && ctx.Err() == nil {
			slog.ErrorContext(cleanup, "清理过期 OAuth 授权请求失败", "operation", "cleanup", "error", err)
		}
		cancel()
		s.refreshCredentials(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func isOAuthRefreshFailure(err error) bool {
	var failure *resource.Error
	return errors.As(err, &failure) && failure.Code == "oauth_refresh_failed"
}
