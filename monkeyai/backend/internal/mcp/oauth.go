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
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type oauthConfig struct {
	AuthorizationURL string `json:"authorization_url"`
	TokenURL         string `json:"token_url"`
	ClientID         string `json:"client_id"`
	Scopes           string `json:"scopes"`
}

func oauthSettings(c resource.Object) oauthConfig {
	b, _ := json.Marshal(c["oauth_config"])
	var o oauthConfig
	_ = json.Unmarshal(b, &o)
	return o
}
func token() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
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
	defer tx.Rollback(ctx)
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
	data := resource.Object{"id": resource.ID(), "connector_id": c.String("id"), "user_id": u.ID, "config_revision": c.Int("config_revision")}
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
	state, verifier := token(), token()
	redirect := s.callbackURL(c.String("id"))
	data["state_hash"], data["verifier"], data["redirect_uri"] = hash(state), verifier, redirect
	b, _ := json.Marshal(data)
	request, err := resource.DecodeObject(sqlc.New(tx).CreateOAuthRequest(ctx, b))
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	o := oauthSettings(c)
	target, _ := url.Parse(o.AuthorizationURL)
	q := target.Query()
	q.Set("response_type", "code")
	q.Set("client_id", o.ClientID)
	q.Set("redirect_uri", redirect)
	q.Set("state", state)
	q.Set("scope", o.Scopes)
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
		_, _ = sqlc.New(s.Store.Pool).FinishOAuthRequest(cleanup, sqlc.FinishOAuthRequestParams{ID: request.String("id"), Status: "failed", CredentialID: ""})
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
	_ = tx.Rollback(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	result, err := exchange(ctx, c, url.Values{"grant_type": {"authorization_code"}, "code": {r.URL.Query().Get("code")}, "redirect_uri": {request.String("redirect_uri")}, "code_verifier": {request.String("verifier")}})
	if err != nil {
		resource.Fail(w, &resource.Error{Status: 502, Code: "oauth_exchange_failed", Message: "OAuth Token 交换失败，请重新发起授权"})
		return
	}
	tx, err = s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
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
	b, _ := json.Marshal(data)
	queries := sqlc.New(tx)
	if create {
		_, err = queries.CreateCredential(ctx, b)
	} else {
		_, err = queries.UpdateCredential(ctx, b)
	}
	if err == nil {
		_, err = queries.InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: id, CredentialID: credential})
	}
	if err == nil {
		var rows int64
		rows, err = queries.FinishOAuthRequest(ctx, sqlc.FinishOAuthRequestParams{ID: request.String("id"), Status: "succeeded", CredentialID: credential})
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
	success = true
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>授权成功</title><p>授权成功，请返回 MonkeyAI 并测试所选凭证。</p></html>")
}

type tokens struct {
	Access, Refresh string
	Expires         *time.Time
}

var invalidGrant = errors.New("OAuth 凭证已失效")

func exchange(ctx context.Context, c resource.Object, v url.Values) (tokens, error) {
	o := oauthSettings(c)
	v.Set("client_id", o.ClientID)
	if secret := c.String("oauth_client_secret"); secret != "" {
		v.Set("client_secret", secret)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", o.TokenURL, strings.NewReader(v.Encode()))
	if err != nil {
		return tokens{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	h := client()
	defer h.CloseIdleConnections()
	resp, err := h.Do(req)
	if err != nil {
		return tokens{}, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return tokens{}, fmt.Errorf("Token 响应无效")
	}
	var payload struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
		Expires int64  `json:"expires_in"`
		Type    string `json:"token_type"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(data, &payload) != nil {
		return tokens{}, fmt.Errorf("Token 响应无效")
	}
	if resp.StatusCode == 400 && payload.Error == "invalid_grant" {
		return tokens{}, invalidGrant
	}
	if resp.StatusCode != 200 || payload.Error != "" || payload.Access == "" || strings.ContainsAny(payload.Access, "\r\n") || (!strings.EqualFold(payload.Type, "bearer") && payload.Type != "") {
		return tokens{}, fmt.Errorf("Token 交换失败")
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
	defer tx.Rollback(ctx)
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
func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		cleanup, cancel := context.WithTimeout(ctx, 10*time.Second)
		_ = sqlc.New(s.Store.Pool).CleanupOAuthRequests(cleanup)
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
