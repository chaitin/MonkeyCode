package mcp

import (
	"context"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc/connector"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	storage    resource.Storage
	Connectors *resource.CRUD
	Store      *resource.Store
	PublicURL  string
}

func NewService(store *resource.Store, publicURL string) *Service {
	s := &Service{Store: store, PublicURL: strings.TrimRight(publicURL, "/")}
	s.Connectors = resource.NewCRUD(store, resource.Definition{
		Kind: "connector", Path: "/connectors",
		Repository: func(q resource.Queryer) resource.Repository { return connector.New(q) },
		Fields:     []string{"name", "description", "url", "authorization_mode", "authorization_method", "oauth_config", "oauth_client_secret", "enabled", "config_revision", "connection_status"},
		UserFields: []string{"name", "description", "url", "authorization_mode", "authorization_method", "oauth_config", "oauth_client_secret"},
		Hidden:     []string{"oauth_client_secret", "icon_s3_key"},
		Validate:   s.validateConnector, Decorate: s.decorateConnector, UserDecorate: userIcon,
		References: func(ctx context.Context, tx pgx.Tx, id string) ([]resource.Object, error) {
			return resource.DecodeObjects(sqlc.New(tx).ListConnectorReferences(ctx, id))
		},
	})
	return s
}

func (s *Service) validateConnector(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	if _, exists := in["provider_id"]; exists {
		return resource.Invalid("连接不再使用 Provider，请直接配置连接地址和认证方式")
	}
	fields := []string{"url", "authorization_mode", "authorization_method", "oauth_config"}
	for _, key := range fields {
		if _, ok := in[key]; !ok {
			in[key] = old[key]
		}
	}
	if !validURL(in.String("url")) {
		return resource.Invalid("MCP URL 无效")
	}
	mode, method := in.String("authorization_mode"), in.String("authorization_method")
	if in.String("ownership_type") == "user" && mode != "none" && mode != "independent" {
		return resource.Invalid("个人连接仅支持无认证或独立认证")
	}
	if mode == "none" {
		in["authorization_method"], method = nil, ""
	} else if (mode != "centralized" && mode != "independent") || (method != "http_header" && method != "oauth") {
		return resource.Invalid("认证组合无效")
	}
	if method == "oauth" {
		o := oauthSettings(in)
		if !validURL(o.AuthorizationURL) || !validURL(o.TokenURL) || o.ClientID == "" {
			return resource.Invalid("OAuth 应用配置不完整")
		}
		o.Scopes = strings.Join(strings.Fields(o.Scopes), " ")
		in["oauth_config"] = resource.Object{"authorization_url": o.AuthorizationURL, "token_url": o.TokenURL, "client_id": o.ClientID, "scopes": o.Scopes}
		if _, exists := in["oauth_client_secret"]; !exists {
			prev := oauthSettings(old)
			in["oauth_client_secret"] = old.String("oauth_client_secret")
			if prev.ClientID != o.ClientID || prev.TokenURL != o.TokenURL || prev.AuthorizationURL != o.AuthorizationURL {
				in["oauth_client_secret"] = ""
			}
		}
	} else {
		in["oauth_config"], in["oauth_client_secret"] = resource.Object{}, ""
	}
	revision := old.Int("config_revision")
	changed := false
	for _, key := range fields {
		changed = changed || resource.Hash(in[key]) != resource.Hash(old[key])
	}
	if old.String("id") == "" {
		revision = 1
	} else if changed {
		revision++
		if err := sqlc.New(tx).InvalidateConnectorTools(ctx, old.String("id")); err != nil {
			return err
		}
		if mode != old.String("authorization_mode") {
			if err := sqlc.New(tx).RevokeConnectorCredentials(ctx, old.String("id")); err != nil {
				return err
			}
		}
	}
	in["config_revision"] = revision
	in["connection_status"] = old.String("connection_status")
	if changed || old.String("id") == "" {
		in["connection_status"] = "unknown"
	}
	return nil
}

func (s *Service) decorateConnector(ctx context.Context, q resource.Queryer, o resource.Object) error {
	o["callback_url"], o["icon_path"] = "", ""
	if o.String("authorization_method") == "oauth" {
		o["callback_url"] = s.callbackURL(o.String("id"))
	}
	if key := o.String("icon_s3_key"); key != "" {
		o["icon_path"] = "/api/admin/v1/connectors/" + o.String("id") + "/icon?v=" + resource.Hash(key)
	}
	count, err := sqlc.New(q).CountTools(ctx, o.String("id"))
	if err != nil {
		return err
	}
	o["tool_count"] = count
	creds := []resource.Object{}
	if o.String("authorization_mode") == "centralized" || o.String("ownership_type") == "user" {
		user := ""
		if o.String("authorization_mode") == "independent" {
			user = o.String("owner_user_id")
		}
		creds, err = s.Credentials(ctx, q, o, user)
		if err != nil {
			return err
		}
	}
	o["credentials"], o["credential_configured"] = creds, false
	for _, cred := range creds {
		if cred.String("authorization_status") == "authorized" {
			o["credential_configured"] = true
		}
	}
	if o.String("authorization_mode") != "none" {
		delete(o, "connection_status")
		delete(o, "last_checked_at")
		delete(o, "last_error")
	}
	return nil
}

func userIcon(o resource.Object) {
	o["icon_path"] = strings.Replace(o.String("icon_path"), "/api/admin/v1/", "/api/v1/", 1)
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

func (s *Service) lockConnector(ctx context.Context, tx pgx.Tx, id, user string, admin bool) (resource.Object, error) {
	if _, err := sqlc.New(tx).LockConnector(ctx, id); err != nil {
		return nil, err
	}
	return s.Connector(ctx, tx, id, user, admin)
}

func (s *Service) RegisterAdmin(r chi.Router) {
	s.Connectors.Register(r)
	s.routes(r, true)
	s.iconRoutes(r, true)
}
func (s *Service) RegisterAgent(r chi.Router) {
	s.Connectors.RegisterAgent(r)
	s.routes(r, false)
	s.iconRoutes(r, false)
}
func (s *Service) routes(r chi.Router, admin bool) {
	s.credentialRoutes(r, admin)
	r.Post("/connectors/{id}/test", func(w http.ResponseWriter, r *http.Request) { s.test(w, r, admin) })
	r.Get("/connectors/{id}/tools", func(w http.ResponseWriter, r *http.Request) { s.tools(w, r, admin) })
	r.Post("/connectors/{id}/credentials/{credentialID}/test", func(w http.ResponseWriter, r *http.Request) { s.test(w, r, admin) })
	r.Get("/connectors/{id}/credentials/{credentialID}/tools", func(w http.ResponseWriter, r *http.Request) { s.tools(w, r, admin) })
	r.Post("/connectors/{id}/oauth/authorizations", func(w http.ResponseWriter, r *http.Request) { s.authorize(w, r, admin) })
	r.Post("/connectors/{id}/credentials/{credentialID}/oauth/authorizations", func(w http.ResponseWriter, r *http.Request) { s.authorize(w, r, admin) })
	r.Get("/connector-authorizations/{id}", s.authorizationStatus)
	if admin {
		r.Patch("/connectors/{id}/tools/{toolID}", s.updateTool)
		r.Get("/connectors/{id}/tool-contexts", s.toolContexts)
	}
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
