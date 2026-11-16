package mcp

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) liveTools(ctx context.Context, q resource.Queryer, c, cred resource.Object, admin bool) ([]resource.Object, error) {
	headers, cred, err := s.headers(ctx, c, cred)
	if err != nil {
		return nil, err
	}
	h, err := s.clientFor(ctx, c.String("proxy_id"))
	if err != nil {
		return nil, err
	}
	setConnectorTimeout(h, c.Int("timeout_ms"))
	remote, err := discoverWithClient(ctx, c.String("url"), headers, h)
	if err != nil {
		return nil, upstreamFailure(err, "mcp_protocol_invalid")
	}
	settings := []resource.Object{}
	if c.String("authorization_mode") != "independent" {
		settings, err = resource.DecodeObjects(sqlc.New(q).ListTools(ctx, sqlc.ListToolsParams{
			ConnectorID: c.String("id"), CredentialID: cred.String("id"),
		}))
		if err != nil {
			return nil, err
		}
	}
	return toolViews(c, cred, remote, settings, admin), nil
}

func toolID(c, cred resource.Object, name string) string {
	// 未保存配置时也提供稳定标识，查询工具不需要为此创建数据库记录。
	sum := sha256.Sum256([]byte(c.String("id") + "\x00" + cred.String("id") + "\x00" + name))
	sum[6] = sum[6]&0x0f | 0x50
	sum[8] = sum[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

func toolViews(c, cred resource.Object, remote []remoteTool, settings []resource.Object, admin bool) []resource.Object {
	byName := make(map[string]resource.Object, len(settings))
	if c.String("authorization_mode") != "independent" {
		for _, setting := range settings {
			byName[setting.String("name")] = setting
		}
	}
	out := make([]resource.Object, 0, len(remote))
	for _, tool := range remote {
		view := resource.Object{"id": toolID(c, cred, tool.Name), "name": tool.Name, "description": tool.Description, "input_schema": tool.InputSchema, "enabled": true, "credits_per_call": int64(0)}
		if setting := byName[tool.Name]; setting != nil {
			view["id"], view["enabled"], view["credits_per_call"] = setting["id"], setting["enabled"], setting["credits_per_call"]
		}
		if admin || view.Bool("enabled") {
			out = append(out, view)
		}
	}
	slices.SortFunc(out, func(a, b resource.Object) int { return strings.Compare(a.String("name"), b.String("name")) })
	return out
}
func (s *Service) Tools(ctx context.Context, q resource.Queryer, c resource.Object, user, id string, admin bool) ([]resource.Object, error) {
	cred, err := s.Credential(ctx, q, c, user, id)
	if err != nil {
		return nil, err
	}
	return s.liveTools(ctx, q, c, cred, admin)
}
func safeTools(tools []resource.Object) []resource.Object {
	out := []resource.Object{}
	for _, tool := range tools {
		out = append(out, resource.Object{"id": tool["id"], "name": tool["name"], "description": tool["description"], "input_schema": tool["input_schema"], "enabled": tool["enabled"], "credits_per_call": tool["credits_per_call"]})
	}
	return out
}
func (s *Service) tools(w http.ResponseWriter, r *http.Request, admin bool) {
	w.Header().Set("Cache-Control", "private, no-store")
	u, _ := identity.UserFromContext(r.Context())
	c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	id, user := chi.URLParam(r, "credentialID"), u.ID
	if admin && c.String("authorization_mode") == "independent" && id != "" {
		cred, err := resource.DecodeObject(sqlc.New(s.Store.Pool).GetCredential(r.Context(), sqlc.GetCredentialParams{ID: id, ConnectorID: c.String("id")}))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		user = cred.String("user_id")
	}
	out, err := s.Tools(r.Context(), s.Store.Pool, c, user, id, admin)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if !admin {
		out = safeTools(out)
	}
	resource.JSON(r.Context(), w, 200, resource.Object{"items": out})
}
func (s *Service) toolContexts(w http.ResponseWriter, r *http.Request) {
	u, _ := identity.UserFromContext(r.Context())
	c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, true)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	creds, err := resource.DecodeObjects(sqlc.New(s.Store.Pool).ListToolContexts(r.Context(), c.String("id")))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	out, err := credentialViews(r.Context(), s.Store.Pool, c, creds...)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, 200, resource.Object{"items": out})
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
	b, err := json.Marshal(cred["http_headers"])
	if err != nil {
		return nil, nil, fmt.Errorf("编码认证 Header: %w", err)
	}
	headers, err := decodeHeaders(b)
	return headers, cred, err
}
func (s *Service) test(w http.ResponseWriter, r *http.Request, admin bool) {
	ctx := r.Context()
	u, _ := identity.UserFromContext(ctx)
	c, err := s.Connector(ctx, s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if admin && c.String("authorization_mode") == "independent" {
		resource.Fail(r.Context(), w, resource.InvalidCode("mcp_test_denied", "独立认证连接由凭证所有者测试"))
		return
	}
	if !admin && c.String("authorization_mode") == "centralized" {
		resource.Fail(r.Context(), w, resource.InvalidCode("mcp_test_denied", "集中认证连接由管理员测试"))
		return
	}
	cred, err := s.Credential(ctx, s.Store.Pool, c, u.ID, chi.URLParam(r, "credentialID"))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	out, err := s.testConnection(ctx, c, cred, u.ID, admin)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, 200, out)
}
func (s *Service) testConnection(ctx context.Context, c, cred resource.Object, user string, admin bool) (resource.Object, error) {
	headers, cred, err := s.headers(ctx, c, cred)
	if err != nil {
		return nil, err
	}
	h, err := s.clientFor(ctx, c.String("proxy_id"))
	if err != nil {
		return nil, err
	}
	setConnectorTimeout(h, c.Int("timeout_ms"))
	tools, discoveryErr := discoverWithClient(ctx, c.String("url"), headers, h)
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollbackMCP(ctx, tx, c.String("id"), cred.String("id"), "test_connection")
	current, err := s.lockConnector(ctx, tx, c.String("id"), user, admin)
	if err != nil {
		return nil, err
	}
	if current.Int("config_revision") != c.Int("config_revision") {
		return nil, resource.Conflict
	}
	if cred != nil {
		fresh, err := resource.DecodeObject(sqlc.New(tx).LockCredential(ctx, cred.String("id")))
		if err != nil {
			return nil, err
		}
		if fresh.Int("revision") != cred.Int("revision") || credentialStatus(current, fresh) != "authorized" {
			return nil, resource.Conflict
		}
	}
	queries := sqlc.New(tx)
	status, message := "connected", ""
	var fault *resource.Error
	if discoveryErr != nil {
		fault = upstreamFailure(discoveryErr, "mcp_protocol_invalid")
		status, message = "error", fault.Error()
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
		return nil, err
	}
	if discoveryErr != nil {
		slog.WarnContext(ctx, "操作失败", "module", "mcp", "operation", "testConnection", "error", discoveryErr)
		return nil, fault
	}
	return resource.Object{"credential_id": cred.String("id"), "connection_status": status, "tool_count": len(tools)}, nil
}
