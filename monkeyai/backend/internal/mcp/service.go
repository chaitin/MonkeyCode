package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc/connector"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc/provider"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	storage               resource.Storage
	Providers, Connectors *resource.CRUD
	Store                 *resource.Store
	PublicURL             string
}

func NewService(store *resource.Store, publicURL string) *Service {
	s := &Service{Store: store, PublicURL: strings.TrimRight(publicURL, "/")}
	s.Providers = resource.NewCRUD(store, resource.Definition{Kind: "provider", Repository: func(q resource.Queryer) resource.Repository { return provider.New(q) }, Path: "/connector-providers", Fields: []string{"identifier", "name", "description", "url", "authorization_mode", "authorization_method", "header_schema", "oauth_config", "oauth_client_secret", "enabled"}, UserFields: []string{"name", "description", "url", "authorization_mode", "authorization_method", "header_schema", "oauth_config", "oauth_client_secret"}, Hidden: []string{"oauth_client_secret", "icon_s3_key"}, Decorate: func(ctx context.Context, q resource.Queryer, o resource.Object) error {
		o["icon_path"] = ""
		if key := o.String("icon_s3_key"); key != "" {
			o["icon_path"] = "/api/admin/v1/connector-providers/" + o.String("id") + "/icon?v=" + resource.Hash(key)
		}
		return nil
	}, UserDecorate: userIcon, Validate: validateProvider, References: func(ctx context.Context, tx pgx.Tx, id string) ([]resource.Object, error) {
		return resource.DecodeObjects(sqlc.New(tx).ListProviderReferences(ctx, id))
	}})
	s.Connectors = resource.NewCRUD(store, resource.Definition{Kind: "connector", Repository: func(q resource.Queryer) resource.Repository { return connector.New(q) }, Path: "/connectors", Fields: []string{"provider_id", "name", "description", "url", "authorization_mode", "authorization_method", "oauth_config", "oauth_client_secret", "enabled", "config_revision", "connection_status"}, UserFields: []string{"provider_id", "name", "description"}, Hidden: []string{"oauth_client_secret"}, Validate: s.validateConnector, Decorate: s.decorateConnector, UserDecorate: userIcon})
	return s
}
func validateProvider(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	if in.String("ownership_type") == "user" {
		in["identifier"] = old["identifier"]
		if old.String("id") == "" {
			in["identifier"] = "custom:" + in.String("id")
		}
		for _, key := range []string{"url", "authorization_mode", "authorization_method", "oauth_config"} {
			if _, ok := in[key]; !ok && old.String("id") != "" {
				in[key] = old[key]
			}
		}
		if in.String("authorization_mode") != "none" && in.String("authorization_mode") != "independent" {
			return resource.Invalid("个人 Provider 仅支持无认证或独立认证")
		}
	}
	if strings.TrimSpace(in.String("identifier")) == "" {
		in["identifier"] = old.String("identifier")
		if old.String("id") == "" {
			in["identifier"] = resource.ID()
		}
	}
	if !validURL(in.String("url")) {
		return resource.Invalid("MCP URL 无效")
	}
	mode := in.String("authorization_mode")
	method := in.String("authorization_method")
	if mode == "none" {
		in["authorization_method"] = nil
		method = ""
	} else if (mode != "centralized" && mode != "independent") || (method != "http_header" && method != "oauth") {
		return resource.Invalid("认证组合无效")
	}
	if method == "oauth" {
		b, _ := json.Marshal(in["oauth_config"])
		var o oauthConfig
		if json.Unmarshal(b, &o) != nil || !validURL(o.AuthorizationURL) || !validURL(o.TokenURL) || o.ClientID == "" {
			return resource.Invalid("OAuth 应用配置不完整")
		}
		in["oauth_config"] = resource.Object{"authorization_url": o.AuthorizationURL, "token_url": o.TokenURL, "client_id": o.ClientID, "scopes": o.Scopes}
	}
	if old.String("id") != "" {
		for _, key := range []string{"url", "authorization_mode", "authorization_method", "oauth_config"} {
			if resource.Hash(in[key]) != resource.Hash(old[key]) {
				used, err := sqlc.New(tx).ProviderInUse(ctx, old.String("id"))
				if err != nil {
					return err
				}

				if used {
					return resource.Invalid("已有实例的连接模板不可更换，请创建新的 Provider")
				}
			}
		}
		if secret := in.String("oauth_client_secret"); secret != "" && secret != old.String("oauth_client_secret") {
			if _, err := sqlc.New(tx).UpdateProviderSecrets(ctx, sqlc.UpdateProviderSecretsParams{ProviderID: old.String("id"), OauthClientSecret: secret}); err != nil {
				return err
			}
		}
	}
	if in.String("oauth_client_secret") == "" {
		delete(in, "oauth_client_secret")
	}
	return nil
}
func (s *Service) validateConnector(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	personal := in.String("ownership_type") == "user"
	if personal && old.String("id") != "" {
		if _, ok := in["provider_id"]; !ok {
			in["provider_id"] = old["provider_id"]
		}
	}
	var p resource.Object
	var err error
	if personal {
		p, err = resource.DecodeObject(sqlc.New(tx).GetUserProvider(ctx, sqlc.GetUserProviderParams{ID: in.String("provider_id"), UserID: in.String("actor_id")}))
	} else {
		p, err = resource.DecodeObject(sqlc.New(tx).GetEnabledProvider(ctx, in.String("provider_id")))
	}
	if err != nil {
		return resource.Invalid("Provider 不存在或已禁用")
	}
	if !p.Bool("enabled") || (personal && p.String("authorization_mode") != "none" && p.String("authorization_mode") != "independent") {
		return resource.Invalid("Provider 不可用于创建个人连接")
	}
	if old.String("id") != "" && old.String("provider_id") != p.String("id") {
		return resource.Invalid("更换 Provider 请创建新连接")
	}
	if in.String("url") != "" && in.String("url") != p.String("url") {
		return resource.Invalid("连接目标必须匹配 Provider 模板")
	}
	for _, k := range []string{"url", "authorization_mode", "authorization_method", "oauth_config", "oauth_client_secret"} {
		in[k] = p[k]
	}
	if old.String("id") == "" {
		in["config_revision"] = 1
		in["connection_status"] = "unknown"
	} else {
		in["config_revision"] = old["config_revision"]
		in["connection_status"] = old["connection_status"]
	}
	return nil
}
func (s *Service) decorateConnector(ctx context.Context, q resource.Queryer, o resource.Object) error {
	user := ""
	if o.String("ownership_type") == "user" {
		user = o.String("owner_user_id")
	}
	configured, err := sqlc.New(q).HasCredential(ctx, sqlc.HasCredentialParams{ConnectorID: o.String("id"), UserID: user, ConfigRevision: int64(o.Int("config_revision"))})
	if err != nil {
		return err
	}

	o["credential_configured"] = configured
	var count int
	toolCount, err := sqlc.New(q).CountTools(ctx, o.String("id"))
	if err != nil {
		return err
	}
	count = int(toolCount)

	o["tool_count"] = count

	iconKey, err := sqlc.New(q).GetIconKey(ctx, o.String("provider_id"))
	if err != nil {
		return err
	}

	o["icon_path"] = ""
	if iconKey != "" {
		o["icon_path"] = "/api/admin/v1/connector-providers/" + o.String("provider_id") + "/icon?v=" + resource.Hash(iconKey)
	}
	return nil
}
func (s *Service) Connector(ctx context.Context, q resource.Queryer, id, user string, admin bool) (resource.Object, error) {
	active, err := sqlc.New(q).UserActive(ctx, sqlc.UserActiveParams{ID: user, IsAdmin: admin})
	if err != nil {
		return nil, err
	}

	if !active {
		return nil, resource.NotFound
	}
	o, err := resource.DecodeObject(sqlc.New(q).GetConnector(ctx, id))
	if err != nil {
		return nil, err
	}
	if admin {
		if o.String("ownership_type") == "user" {
			return nil, resource.NotFound
		}
	} else {
		ok, err := resource.Accessible(ctx, q, "connector", o, user)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, resource.NotFound
		}
	}
	return o, nil
}
func (s *Service) Credential(ctx context.Context, q resource.Queryer, c resource.Object, user string) (resource.Object, error) {
	if c.String("authorization_mode") == "none" {
		return nil, nil
	}
	if c.String("authorization_mode") == "centralized" {
		user = ""
	}
	return resource.DecodeObject(sqlc.New(q).GetCredential(ctx, sqlc.GetCredentialParams{ConnectorID: c.String("id"), UserID: user, ConfigRevision: int64(c.Int("config_revision"))}))
}
func (s *Service) RegisterAdmin(r chi.Router) {
	s.Providers.Register(r)
	s.Connectors.Register(r)
	s.routes(r, true)
	s.iconRoutes(r, true)
}
func (s *Service) RegisterAgent(r chi.Router) {
	s.Providers.RegisterAgent(r)
	s.Connectors.RegisterAgent(r)
	r.Get("/connector-providers", s.listProviders)
	r.Get("/connector-providers/{id}", s.getProvider)
	s.routes(r, false)
	s.iconRoutes(r, false)
}
func (s *Service) routes(r chi.Router, admin bool) {
	r.Put("/connectors/{id}/credential", func(w http.ResponseWriter, r *http.Request) { s.credential(w, r, admin, false) })
	r.Delete("/connectors/{id}/credential", func(w http.ResponseWriter, r *http.Request) { s.credential(w, r, admin, true) })
	r.Post("/connectors/{id}/test", func(w http.ResponseWriter, r *http.Request) { s.test(w, r, admin) })
	r.Get("/connectors/{id}/tools", func(w http.ResponseWriter, r *http.Request) {
		u, _ := identity.UserFromContext(r.Context())
		c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		user := u.ID
		if admin && r.URL.Query().Get("user_id") != "" {
			user = r.URL.Query().Get("user_id")
		}
		out, err := s.Tools(r.Context(), s.Store.Pool, c, user, admin)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if !admin {
			safe := []resource.Object{}
			for _, t := range out {
				safe = append(safe, resource.Object{"id": t["id"], "name": t["name"], "description": t["description"], "input_schema": t["input_schema"], "enabled": t["enabled"], "credits_per_call": t["credits_per_call"]})
			}
			out = safe
		}
		resource.JSON(w, 200, resource.Object{"items": out})
	})
	if admin {
		r.Patch("/connectors/{id}/tools/{toolID}", s.updateTool)
	}
	r.Post("/connectors/{id}/oauth/authorizations", func(w http.ResponseWriter, r *http.Request) { s.authorize(w, r, admin) })
	r.Get("/connector-authorizations/{id}", s.authorizationStatus)
}
func (s *Service) credential(w http.ResponseWriter, r *http.Request, admin, revoke bool) {
	u, _ := identity.UserFromContext(r.Context())
	tx, err := s.Store.Pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	c, err := s.Connector(r.Context(), tx, chi.URLParam(r, "id"), u.ID, admin)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	mode := c.String("authorization_mode")
	if (admin && mode != "centralized") || (!admin && mode != "independent") {
		resource.Fail(w, resource.Invalid("当前调用方不能管理此认证上下文"))
		return
	}
	user := u.ID
	if admin {
		user = ""
	}
	if revoke {
		_, err = sqlc.New(tx).RevokeCredential(r.Context(), sqlc.RevokeCredentialParams{ConnectorID: c.String("id"), UserID: user})
	} else {
		if c.String("authorization_method") != "http_header" {
			resource.Fail(w, resource.Invalid("此连接使用 OAuth"))
			return
		}
		var in struct {
			Headers map[string]string `json:"http_headers"`
		}
		if err = resource.Decode(w, r, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		if len(in.Headers) == 0 || len(in.Headers) > 30 {
			resource.Fail(w, resource.Invalid("认证 Header 不能为空或过多"))
			return
		}
		for k, v := range in.Headers {
			key := strings.ToLower(k)
			if strings.ContainsAny(k+v, "\r\n") || strings.ContainsAny(k, " :\t") || k == "" || key == "host" || key == "content-length" || key == "connection" || strings.HasPrefix(key, "mcp-") {
				resource.Fail(w, resource.Invalid("认证 Header 无效"))
				return
			}
		}
		b, _ := json.Marshal(in.Headers)
		_, err = sqlc.New(tx).UpsertHeaderCredential(r.Context(), sqlc.UpsertHeaderCredentialParams{
			ConnectorID:    c.String("id"),
			UserID:         user,
			HttpHeaders:    b,
			ConfigRevision: int64(c.Int("config_revision")),
		})
	}
	if err == nil {
		_, err = sqlc.New(tx).InvalidateConnectorUserTools(r.Context(), sqlc.InvalidateConnectorUserToolsParams{ConnectorID: c.String("id"), UserID: user})
	}
	if err == nil {
		err = resource.Audit(r.Context(), tx, u.ID, "connector", c.String("id"), "credential_update")
	}

	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	w.WriteHeader(204)
}
func (s *Service) Tools(ctx context.Context, q resource.Queryer, c resource.Object, user string, admin bool) ([]resource.Object, error) {
	cred, err := s.Credential(ctx, q, c, user)
	if err != nil {
		if err == pgx.ErrNoRows {
			return []resource.Object{}, nil
		}
		return nil, err
	}
	return credentialTools(ctx, q, c, cred, admin)
}

func credentialTools(ctx context.Context, q resource.Queryer, c, cred resource.Object, admin bool) ([]resource.Object, error) {
	credential := ""
	if cred != nil {
		credential = cred.String("id")
		var current bool
		record, err := sqlc.New(q).CredentialCurrent(ctx, credential)
		if err != nil {
			return nil, err
		}
		current = record != nil && *record

		if !current && cred.String("oauth_refresh_token") == "" {
			return []resource.Object{}, nil
		}
	}
	return resource.DecodeObjects(sqlc.New(q).ListTools(ctx, sqlc.ListToolsParams{
		ConnectorID:    c.String("id"),
		CredentialID:   credential,
		ConfigRevision: int64(c.Int("config_revision")),
		IsAdmin:        admin,
	}))
}
func (s *Service) test(w http.ResponseWriter, r *http.Request, admin bool) {
	u, _ := identity.UserFromContext(r.Context())
	c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if admin && c.String("authorization_mode") == "independent" {
		resource.Fail(w, resource.Invalid("独立认证连接由用户在 Agent 端测试"))
		return
	}
	cred, err := s.Credential(r.Context(), s.Store.Pool, c, u.ID)
	if err != nil {
		resource.Fail(w, resource.Invalid("请先完成认证"))
		return
	}
	headers := map[string]string{}
	credential := ""
	if cred != nil {
		credential = cred.String("id")
		if cred.String("method") == "oauth" {
			cred, err = s.refresh(r.Context(), c, cred)
			if err != nil {
				resource.Fail(w, resource.Invalid("OAuth 已失效，请重新授权"))
				return
			}
			headers["Authorization"] = "Bearer " + cred.String("oauth_access_token")
		} else {
			b, _ := json.Marshal(cred["http_headers"])
			_ = json.Unmarshal(b, &headers)
		}
	}
	tools, err := discover(r.Context(), c.String("url"), headers)
	if err != nil {
		_, _ = sqlc.New(s.Store.Pool).MarkConnectionFailed(r.Context(), c.String("id"))
		resource.Fail(w, &resource.Error{Status: 502, Code: "upstream_error", Message: "MCP 连接或工具发现失败，请检查地址和认证"})
		return
	}
	tx, err := s.Store.Pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	current, err := resource.DecodeObject(sqlc.New(tx).LockConnector(r.Context(), c.String("id")))
	if err != nil || current.Int("config_revision") != c.Int("config_revision") {
		resource.Fail(w, resource.Conflict)
		return
	}
	if credential != "" {
		fresh, err := resource.DecodeObject(sqlc.New(tx).LockCredential(r.Context(), credential))
		if err != nil || fresh["updated_at"] != cred["updated_at"] {
			resource.Fail(w, resource.Conflict)
			return
		}
	}
	_, err = sqlc.New(tx).InvalidateTools(r.Context(), sqlc.InvalidateToolsParams{ConnectorID: c.String("id"), CredentialID: credential})
	for _, t := range tools {
		if err != nil {
			break
		}
		schema, _ := json.Marshal(t.InputSchema)
		_, err = sqlc.New(tx).UpsertTool(r.Context(), sqlc.UpsertToolParams{
			ConnectorID:    c.String("id"),
			CredentialID:   credential,
			Name:           t.Name,
			Description:    t.Description,
			InputSchema:    schema,
			ConfigRevision: int64(c.Int("config_revision")),
		})
	}
	if err == nil {
		_, err = sqlc.New(tx).MarkConnected(r.Context(), c.String("id"))
	}

	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	resource.JSON(w, 200, resource.Object{"connection_status": "connected", "tool_count": len(tools)})
}
func (s *Service) updateTool(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled *bool          `json:"enabled"`
		Credits billing.Amount `json:"credits_per_call"`
	}
	if err := resource.Decode(w, r, &in); err != nil || in.Enabled == nil || in.Credits < 0 {
		resource.Fail(w, resource.Invalid("工具配置无效"))
		return
	}
	tx, err := s.Store.Pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var mode string
	mode, err = sqlc.New(tx).GetAuthorizationMode(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		resource.Fail(w, err)
		return
	}

	if mode != "centralized" && in.Credits != 0 {
		resource.Fail(w, resource.Invalid("仅集中认证工具可以设置非零积分"))
		return
	}
	o, err := resource.DecodeObject(sqlc.New(tx).UpdateTool(r.Context(), sqlc.UpdateToolParams{
		ConnectorID:    chi.URLParam(r, "id"),
		ID:             chi.URLParam(r, "toolID"),
		Enabled:        *in.Enabled,
		CreditsPerCall: in.Credits.String(),
	}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	u, _ := identity.UserFromContext(r.Context())
	err = resource.Audit(r.Context(), tx, u.ID, "mcp_tool", o.String("id"), "configure")

	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	resource.JSON(w, 200, o)
}
