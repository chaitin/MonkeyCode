package mcp

import (
	"context"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

type Service struct {
	storage               resource.Storage
	Providers, Connectors *resource.CRUD
	Store                 *resource.Store
	PublicURL             string
}

func NewService(store *resource.Store, publicURL string) *Service {
	s := &Service{Store: store, PublicURL: strings.TrimRight(publicURL, "/")}
	s.Providers = resource.NewCRUD(store, resource.Definition{Kind: "provider", Table: "connector_providers", Path: "/connector-providers", Fields: []string{"identifier", "name", "description", "url", "authorization_mode", "authorization_method", "header_schema", "oauth_config", "oauth_client_secret", "enabled"}, Hidden: []string{"oauth_client_secret", "icon_s3_key"}, Decorate: func(ctx context.Context, q resource.Queryer, o resource.Object) error {
		o["icon_path"] = ""
		if key := o.String("icon_s3_key"); key != "" {
			o["icon_path"] = "/api/admin/v1/connector-providers/" + o.String("id") + "/icon?v=" + resource.Hash(key)
		}
		return nil
	}, Validate: validateProvider, References: func(ctx context.Context, tx pgx.Tx, id string) ([]resource.Object, error) {
		return resource.Rows(ctx, tx, `SELECT jsonb_build_object('id',id,'name',name,'type','connector') FROM connectors WHERE provider_id=$1 AND deleted_at IS NULL UNION ALL SELECT jsonb_build_object('id',e.id,'name',e.name,'type','expert') FROM experts e JOIN expert_connector_providers x ON x.expert_id=e.id WHERE x.provider_id=$1 AND e.deleted_at IS NULL`, id)
	}})
	s.Connectors = resource.NewCRUD(store, resource.Definition{Kind: "connector", Table: "connectors", Path: "/connectors", Fields: []string{"provider_id", "name", "description", "url", "authorization_mode", "authorization_method", "oauth_config", "oauth_client_secret", "enabled", "config_revision", "connection_status"}, Hidden: []string{"oauth_client_secret"}, Validate: s.validateConnector, Decorate: s.decorateConnector})
	return s
}
func validateProvider(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	if strings.TrimSpace(in.String("identifier")) == "" {
		return resource.Invalid("Provider identifier 不能为空")
	}
	if !validURL(in.String("url")) {
		return resource.Invalid("MCP URL 无效")
	}
	mode := in.String("authorization_mode")
	method := in.String("authorization_method")
	if mode == "none" {
		in["authorization_method"] = nil
	} else if (mode != "centralized" && mode != "independent") || (method != "http_header" && method != "oauth") {
		return resource.Invalid("认证组合无效")
	}
	if method == "oauth" {
		b, _ := json.Marshal(in["oauth_config"])
		var o oauthConfig
		if json.Unmarshal(b, &o) != nil || !validURL(o.AuthorizationURL) || !validURL(o.TokenURL) || o.ClientID == "" {
			return resource.Invalid("OAuth 应用配置不完整")
		}
		clean, _ := json.Marshal(o)
		in["oauth_config"] = json.RawMessage(clean)
	}
	if old.String("id") != "" {
		for _, key := range []string{"url", "authorization_mode", "authorization_method", "oauth_config"} {
			if resource.Hash(in[key]) != resource.Hash(old[key]) {
				var used bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM connectors WHERE provider_id=$1 AND deleted_at IS NULL)`, old.String("id")).Scan(&used); err != nil {
					return err
				}
				if used {
					return resource.Invalid("已有实例的连接模板不可更换，请创建新的 Provider")
				}
			}
		}
		if secret := in.String("oauth_client_secret"); secret != "" && secret != old.String("oauth_client_secret") {
			if _, err := tx.Exec(ctx, `UPDATE connectors SET oauth_client_secret=$2,revision=revision+1,updated_at=now() WHERE provider_id=$1 AND deleted_at IS NULL`, old.String("id"), secret); err != nil {
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
	p, err := resource.Row(ctx, tx, `SELECT to_jsonb(p) FROM connector_providers p WHERE id=$1 AND ownership_type='system' AND deleted_at IS NULL AND enabled FOR SHARE`, in.String("provider_id"))
	if err != nil {
		return resource.Invalid("Provider 不存在或已禁用")
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
	var configured bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM connector_credentials WHERE connector_id=$1 AND user_id IS NULL AND status='authorized' AND revoked_at IS NULL AND config_revision=$2 AND (oauth_expires_at IS NULL OR oauth_expires_at>now()))`, o.String("id"), o.Int("config_revision")).Scan(&configured); err != nil {
		return err
	}
	o["credential_configured"] = configured
	var count int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM mcp_tools WHERE connector_id=$1 AND deleted_at IS NULL`, o.String("id")).Scan(&count); err != nil {
		return err
	}
	o["tool_count"] = count
	var iconKey string
	if err := q.QueryRow(ctx, `SELECT icon_s3_key FROM connector_providers WHERE id=$1`, o.String("provider_id")).Scan(&iconKey); err != nil {
		return err
	}
	o["icon_path"] = ""
	if iconKey != "" {
		o["icon_path"] = "/api/admin/v1/connector-providers/" + o.String("provider_id") + "/icon?v=" + resource.Hash(iconKey)
	}
	return nil
}
func (s *Service) Connector(ctx context.Context, q resource.Queryer, id, user string, admin bool) (resource.Object, error) {
	var active bool
	if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL AND (NOT $2 OR role='admin'))`, user, admin).Scan(&active); err != nil {
		return nil, err
	}
	if !active {
		return nil, resource.NotFound
	}
	o, err := resource.Row(ctx, q, `SELECT to_jsonb(c) FROM connectors c JOIN connector_providers p ON p.id=c.provider_id WHERE c.id=$1 AND c.deleted_at IS NULL AND c.enabled AND p.deleted_at IS NULL AND p.enabled`, id)
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
	return resource.Row(ctx, q, `SELECT to_jsonb(c) FROM connector_credentials c WHERE connector_id=$1 AND user_id IS NOT DISTINCT FROM NULLIF($2,'')::uuid AND revoked_at IS NULL AND status='authorized' AND config_revision=$3`, c.String("id"), user, c.Int("config_revision"))
}
func (s *Service) RegisterAdmin(r chi.Router) {
	s.Providers.Register(r)
	s.Connectors.Register(r)
	s.routes(r, true)
	s.iconRoutes(r, true)
}
func (s *Service) RegisterAgent(r chi.Router) {
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
		_, err = tx.Exec(r.Context(), `UPDATE connector_credentials SET revoked_at=now(),status='revoked',updated_at=now() WHERE connector_id=$1 AND user_id IS NOT DISTINCT FROM NULLIF($2,'')::uuid`, c.String("id"), user)
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
		_, err = tx.Exec(r.Context(), `INSERT INTO connector_credentials(connector_id,user_id,method,http_headers,config_revision) VALUES($1,NULLIF($2,'')::uuid,'http_header',$3,$4) ON CONFLICT(connector_id,user_id) DO UPDATE SET http_headers=EXCLUDED.http_headers,config_revision=EXCLUDED.config_revision,revoked_at=NULL,status='authorized',updated_at=now()`, c.String("id"), user, b, c.Int("config_revision"))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE mcp_tools SET deleted_at=now() WHERE connector_id=$1 AND credential_id IN (SELECT id FROM connector_credentials WHERE connector_id=$1 AND user_id IS NOT DISTINCT FROM NULLIF($2,'')::uuid)`, c.String("id"), user)
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
	credential := ""
	if cred != nil {
		credential = cred.String("id")
		var current bool
		if err := q.QueryRow(ctx, `SELECT oauth_expires_at IS NULL OR oauth_expires_at>now() FROM connector_credentials WHERE id=$1`, credential).Scan(&current); err != nil {
			return nil, err
		}
		if !current {
			return []resource.Object{}, nil
		}
	}
	return resource.Rows(ctx, q, `SELECT to_jsonb(t) FROM mcp_tools t WHERE connector_id=$1 AND credential_id IS NOT DISTINCT FROM NULLIF($2,'')::uuid AND config_revision=$3 AND deleted_at IS NULL AND ($4 OR enabled) ORDER BY name,id`, c.String("id"), credential, c.Int("config_revision"), admin)
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
		_, _ = s.Store.Pool.Exec(r.Context(), `UPDATE connectors SET connection_status='error',last_checked_at=now(),last_error='MCP 连接或工具发现失败',updated_at=now() WHERE id=$1`, c.String("id"))
		resource.Fail(w, &resource.Error{Status: 502, Code: "upstream_error", Message: "MCP 连接或工具发现失败，请检查地址和认证"})
		return
	}
	tx, err := s.Store.Pool.Begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	current, err := resource.Row(r.Context(), tx, `SELECT to_jsonb(c) FROM connectors c WHERE id=$1 AND deleted_at IS NULL AND enabled FOR UPDATE`, c.String("id"))
	if err != nil || current.Int("config_revision") != c.Int("config_revision") {
		resource.Fail(w, resource.Conflict)
		return
	}
	if credential != "" {
		fresh, err := resource.Row(r.Context(), tx, `SELECT to_jsonb(c) FROM connector_credentials c WHERE id=$1 AND revoked_at IS NULL FOR UPDATE`, credential)
		if err != nil || fresh["updated_at"] != cred["updated_at"] {
			resource.Fail(w, resource.Conflict)
			return
		}
	}
	_, err = tx.Exec(r.Context(), `UPDATE mcp_tools SET deleted_at=now() WHERE connector_id=$1 AND credential_id IS NOT DISTINCT FROM NULLIF($2,'')::uuid`, c.String("id"), credential)
	for _, t := range tools {
		if err != nil {
			break
		}
		schema, _ := json.Marshal(t.InputSchema)
		_, err = tx.Exec(r.Context(), `INSERT INTO mcp_tools(connector_id,credential_id,name,description,input_schema,config_revision) VALUES($1,NULLIF($2,'')::uuid,$3,$4,$5,$6) ON CONFLICT(connector_id,credential_id,name) DO UPDATE SET description=EXCLUDED.description,input_schema=EXCLUDED.input_schema,config_revision=EXCLUDED.config_revision,discovered_at=now(),updated_at=now(),deleted_at=NULL`, c.String("id"), credential, t.Name, t.Description, schema, c.Int("config_revision"))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE connectors SET connection_status='connected',last_checked_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`, c.String("id"))
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
	if err = tx.QueryRow(r.Context(), `SELECT authorization_mode FROM connectors WHERE id=$1 AND deleted_at IS NULL`, chi.URLParam(r, "id")).Scan(&mode); err != nil {
		resource.Fail(w, err)
		return
	}
	if mode != "centralized" && in.Credits != 0 {
		resource.Fail(w, resource.Invalid("仅集中认证工具可以设置非零积分"))
		return
	}
	o, err := resource.Row(r.Context(), tx, `UPDATE mcp_tools t SET enabled=$3,credits_per_call=$4,updated_at=now() FROM connectors c WHERE t.id=$2 AND t.connector_id=$1 AND c.id=t.connector_id AND c.ownership_type='system' AND c.deleted_at IS NULL AND t.deleted_at IS NULL RETURNING to_jsonb(t)`, chi.URLParam(r, "id"), chi.URLParam(r, "toolID"), *in.Enabled, in.Credits.String())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	u, _ := identity.UserFromContext(r.Context())
	if err = resource.Audit(r.Context(), tx, u.ID, "mcp_tool", o.String("id"), "configure"); err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, o)
}
