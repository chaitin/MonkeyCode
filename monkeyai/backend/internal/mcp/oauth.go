package mcp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
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
func (s *Service) authorize(w http.ResponseWriter, r *http.Request, admin bool) {
	u, _ := identity.UserFromContext(r.Context())
	c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if c.String("authorization_method") != "oauth" || (admin && c.String("authorization_mode") != "centralized") || (!admin && c.String("authorization_mode") != "independent") {
		resource.Fail(w, resource.Invalid("此认证上下文不支持 OAuth 授权"))
		return
	}
	state, verifier := token(), token()
	redirect := s.PublicURL + "/oauth/connectors/callback"
	id := resource.ID()
	_, err = s.Store.Pool.Exec(r.Context(), `INSERT INTO connector_oauth_requests(id,connector_id,user_id,centralized,config_revision,state_hash,verifier,redirect_uri,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')`, id, c.String("id"), u.ID, admin, c.Int("config_revision"), hash(state), verifier, redirect)
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
	resource.JSON(w, 200, resource.Object{"id": id, "authorization_url": target.String()})
}
func (s *Service) authorizationStatus(w http.ResponseWriter, r *http.Request) {
	u, _ := identity.UserFromContext(r.Context())
	o, err := resource.Row(r.Context(), s.Store.Pool, `SELECT jsonb_build_object('id',id,'status',CASE WHEN status='pending' AND expires_at<=now() THEN 'expired' ELSE status END) FROM connector_oauth_requests WHERE id=$1 AND user_id=$2`, chi.URLParam(r, "id"), u.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, o)
}
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	request, err := resource.Row(ctx, tx, `UPDATE connector_oauth_requests SET consumed_at=now(),status='processing' WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING to_jsonb(connector_oauth_requests)`, hash(r.URL.Query().Get("state")))
	if err != nil {
		resource.Fail(w, resource.Invalid("授权事务无效或已使用"))
		return
	}
	if err = tx.Commit(ctx); err != nil {
		resource.Fail(w, err)
		return
	}
	success := false
	defer func() {
		status := "error"
		if success {
			status = "authorized"
		}
		_, _ = s.Store.Pool.Exec(context.WithoutCancel(ctx), `UPDATE connector_oauth_requests SET status=$2 WHERE id=$1`, request.String("id"), status)
	}()
	c, err := s.Connector(ctx, s.Store.Pool, request.String("connector_id"), request.String("user_id"), request.Bool("centralized"))
	if err != nil || c.Int("config_revision") != request.Int("config_revision") || r.URL.Query().Get("code") == "" {
		resource.Fail(w, resource.Invalid("授权已失效或取消"))
		return
	}
	values := url.Values{"grant_type": {"authorization_code"}, "code": {r.URL.Query().Get("code")}, "redirect_uri": {request.String("redirect_uri")}, "code_verifier": {request.String("verifier")}}
	tokens, err := exchange(ctx, c, values)
	if err != nil {
		resource.Fail(w, &resource.Error{Status: 502, Code: "oauth_exchange_failed", Message: "OAuth Token 交换失败"})
		return
	}
	user := request.String("user_id")
	if request.Bool("centralized") {
		user = ""
	}
	tx, err = s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	current, err := s.Connector(ctx, tx, c.String("id"), request.String("user_id"), request.Bool("centralized"))
	if err != nil || current.Int("config_revision") != c.Int("config_revision") {
		resource.Fail(w, resource.Conflict)
		return
	}
	_, err = tx.Exec(ctx, `INSERT INTO connector_credentials(connector_id,user_id,method,oauth_access_token,oauth_refresh_token,oauth_expires_at,config_revision) VALUES($1,NULLIF($2,'')::uuid,'oauth',$3,$4,$5,$6) ON CONFLICT(connector_id,user_id) DO UPDATE SET oauth_access_token=EXCLUDED.oauth_access_token,oauth_refresh_token=EXCLUDED.oauth_refresh_token,oauth_expires_at=EXCLUDED.oauth_expires_at,config_revision=EXCLUDED.config_revision,status='authorized',revoked_at=NULL,updated_at=now()`, c.String("id"), user, tokens.Access, tokens.Refresh, tokens.Expires, c.Int("config_revision"))
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE mcp_tools SET deleted_at=now() WHERE credential_id IN(SELECT id FROM connector_credentials WHERE connector_id=$1 AND user_id IS NOT DISTINCT FROM NULLIF($2,'')::uuid)`, c.String("id"), user)
	}
	if err == nil {
		err = resource.Audit(ctx, tx, request.String("user_id"), "connector", c.String("id"), "oauth_authorize")
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
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>授权成功</title><p>授权成功，请返回 MonkeyAI 并测试连接。</p></html>")
}

type tokens struct {
	Access, Refresh string
	Expires         *time.Time
}

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
	if resp.StatusCode != 200 {
		return tokens{}, fmt.Errorf("Token 交换失败")
	}
	var payload struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
		Expires int64  `json:"expires_in"`
		Type    string `json:"token_type"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil || payload.Access == "" || strings.ContainsAny(payload.Access, "\r\n") || (!strings.EqualFold(payload.Type, "bearer") && payload.Type != "") {
		return tokens{}, fmt.Errorf("Token 响应无效")
	}
	result := tokens{Access: payload.Access, Refresh: payload.Refresh}
	if payload.Expires > 0 {
		t := time.Now().Add(time.Duration(min(payload.Expires, 31536000)) * time.Second)
		result.Expires = &t
	}
	return result, nil
}
func (s *Service) refresh(ctx context.Context, c, cred resource.Object) (resource.Object, error) {
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	cred, err = resource.Row(ctx, tx, `SELECT to_jsonb(c) FROM connector_credentials c WHERE id=$1 AND revoked_at IS NULL AND status='authorized' FOR UPDATE`, cred.String("id"))
	if err != nil {
		return nil, err
	}
	var valid bool
	if err = tx.QueryRow(ctx, `SELECT oauth_expires_at IS NULL OR oauth_expires_at>now()+interval '30 seconds' FROM connector_credentials WHERE id=$1`, cred.String("id")).Scan(&valid); err != nil {
		return nil, err
	}
	if valid {
		return cred, nil
	}
	if cred.String("oauth_refresh_token") == "" {
		return nil, resource.Invalid("需要重新授权")
	}
	tokens, err := exchange(ctx, c, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {cred.String("oauth_refresh_token")}})
	if err != nil {
		return nil, err
	}
	if tokens.Refresh == "" {
		tokens.Refresh = cred.String("oauth_refresh_token")
	}
	out, err := resource.Row(ctx, tx, `UPDATE connector_credentials SET oauth_access_token=$2,oauth_refresh_token=$3,oauth_expires_at=$4,updated_at=now() WHERE id=$1 RETURNING to_jsonb(connector_credentials)`, cred.String("id"), tokens.Access, tokens.Refresh, tokens.Expires)
	if err != nil {
		return nil, err
	}
	return out, tx.Commit(ctx)
}
