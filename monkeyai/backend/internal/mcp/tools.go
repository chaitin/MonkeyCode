package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func credentialTools(ctx context.Context, q resource.Queryer, c, cred resource.Object, admin bool) ([]resource.Object, error) {
	if c.String("authorization_mode") != "none" && credentialStatus(c, cred) != "authorized" {
		return []resource.Object{}, nil
	}
	return resource.DecodeObjects(sqlc.New(q).ListTools(ctx, sqlc.ListToolsParams{
		ConnectorID: c.String("id"), CredentialID: cred.String("id"), ConfigRevision: c.Int("config_revision"), IsAdmin: admin,
	}))
}
func (s *Service) Tools(ctx context.Context, q resource.Queryer, c resource.Object, user, id string, admin bool) ([]resource.Object, error) {
	cred, err := s.Credential(ctx, q, c, user, id)
	if err != nil {
		return nil, err
	}
	return credentialTools(ctx, q, c, cred, admin)
}
func safeTools(tools []resource.Object) []resource.Object {
	out := []resource.Object{}
	for _, tool := range tools {
		out = append(out, resource.Object{"id": tool["id"], "name": tool["name"], "description": tool["description"], "input_schema": tool["input_schema"], "enabled": tool["enabled"], "credits_per_call": tool["credits_per_call"]})
	}
	return out
}
func (s *Service) tools(w http.ResponseWriter, r *http.Request, admin bool) {
	u, _ := identity.UserFromContext(r.Context())
	c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	id, user := chi.URLParam(r, "credentialID"), u.ID
	if admin && c.String("authorization_mode") == "independent" && id != "" {
		cred, err := resource.DecodeObject(sqlc.New(s.Store.Pool).GetCredential(r.Context(), sqlc.GetCredentialParams{ID: id, ConnectorID: c.String("id")}))
		if err != nil {
			resource.Fail(w, err)
			return
		}
		user = cred.String("user_id")
	}
	out, err := s.Tools(r.Context(), s.Store.Pool, c, user, id, admin)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if !admin {
		out = safeTools(out)
	}
	resource.JSON(w, 200, resource.Object{"items": out})
}
func (s *Service) toolContexts(w http.ResponseWriter, r *http.Request) {
	u, _ := identity.UserFromContext(r.Context())
	c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, true)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	creds, err := resource.DecodeObjects(sqlc.New(s.Store.Pool).ListToolContexts(r.Context(), c.String("id")))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out, err := credentialViews(r.Context(), s.Store.Pool, c, creds...)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, resource.Object{"items": out})
}
func (s *Service) headers(ctx context.Context, c, cred resource.Object) (map[string]string, resource.Object, error) {
	if c.String("authorization_mode") == "none" {
		return map[string]string{}, nil, nil
	}
	if credentialStatus(c, cred) != "authorized" {
		return nil, nil, authorizationRequired
	}
	if c.String("authorization_method") == "oauth" {
		fresh, err := s.refresh(ctx, c, cred)
		if err != nil {
			return nil, nil, err
		}
		return map[string]string{"Authorization": "Bearer " + fresh.String("oauth_access_token")}, fresh, nil
	}
	b, _ := json.Marshal(cred["http_headers"])
	headers, err := decodeHeaders(b)
	return headers, cred, err
}
func (s *Service) test(w http.ResponseWriter, r *http.Request, admin bool) {
	ctx := r.Context()
	u, _ := identity.UserFromContext(ctx)
	c, err := s.Connector(ctx, s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if admin && c.String("authorization_mode") == "independent" {
		resource.Fail(w, resource.Invalid("独立认证连接由凭证所有者测试"))
		return
	}
	if !admin && c.String("authorization_mode") == "centralized" {
		resource.Fail(w, resource.Invalid("集中认证连接由管理员测试"))
		return
	}
	cred, err := s.Credential(ctx, s.Store.Pool, c, u.ID, chi.URLParam(r, "credentialID"))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	headers, cred, err := s.headers(ctx, c, cred)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	tools, discoveryErr := discover(ctx, c.String("url"), headers)
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	current, err := s.lockConnector(ctx, tx, c.String("id"), u.ID, admin)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if current.Int("config_revision") != c.Int("config_revision") {
		resource.Fail(w, resource.Conflict)
		return
	}
	if cred != nil {
		fresh, err := resource.DecodeObject(sqlc.New(tx).LockCredential(ctx, cred.String("id")))
		if err != nil || fresh.Int("revision") != cred.Int("revision") || credentialStatus(current, fresh) != "authorized" {
			resource.Fail(w, resource.Conflict)
			return
		}
	}
	queries := sqlc.New(tx)
	status, message := "connected", ""
	if discoveryErr != nil {
		status, message = "error", "MCP 连接或工具发现失败，请检查地址和网络"
		var upstreamStatus remoteStatus
		if errors.As(discoveryErr, &upstreamStatus) {
			if upstreamStatus == http.StatusUnauthorized {
				message = "上游认证失败，请更新 Header 或重新授权"
			}
			if upstreamStatus == http.StatusForbidden {
				message = "上游拒绝访问，请检查所选凭证的权限"
			}
		}
	} else {
		_, err = queries.InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: c.String("id"), CredentialID: cred.String("id")})
		for _, tool := range tools {
			if err != nil {
				break
			}
			schema, _ := json.Marshal(tool.InputSchema)
			_, err = queries.UpsertTool(ctx, sqlc.UpsertToolParams{ConnectorID: c.String("id"), CredentialID: cred.String("id"), Name: tool.Name, Description: tool.Description, InputSchema: schema, ConfigRevision: c.Int("config_revision"), Enabled: c.String("ownership_type") == "user"})
		}
	}
	if err == nil {
		if cred == nil {
			err = queries.SetConnectionTest(ctx, sqlc.SetConnectionTestParams{ID: c.String("id"), ConnectionStatus: status, Column3: message})
		} else {
			err = queries.SetCredentialTest(ctx, sqlc.SetCredentialTestParams{ID: cred.String("id"), ConnectionStatus: status, Column3: message})
		}
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if discoveryErr != nil {
		resource.Fail(w, &resource.Error{Status: 502, Code: "upstream_error", Message: message})
		return
	}
	resource.JSON(w, 200, resource.Object{"credential_id": cred.String("id"), "connection_status": status, "tool_count": len(tools)})
}
