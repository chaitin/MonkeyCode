package mcp

import (
	"context"
	"errors"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func (s *Service) gateway(c resource.Object, credential string) resource.Object {
	url := s.PublicURL + "/mcp/connectors/" + c.String("id")
	if credential != "" {
		url += "/credentials/" + credential
	}
	return resource.Object{"url": url, "transport": "streamable_http", "authentication": "api_key", "required_scope": "mcp:invoke"}
}
func (s *Service) ListEntry(ctx context.Context, q resource.Queryer, c resource.Object, user string) (resource.Object, error) {
	return s.catalog(ctx, q, c, user, false)
}

func (s *Service) Catalog(ctx context.Context, q resource.Queryer, c resource.Object, user string) (resource.Object, error) {
	return s.catalog(ctx, q, c, user, true)
}

func (s *Service) catalog(ctx context.Context, q resource.Queryer, c resource.Object, user string, includeTools bool) (resource.Object, error) {
	c, err := resource.DecodeObject(sqlc.New(q).GetConnector(ctx, c.String("id")))
	if err != nil {
		return nil, err
	}
	out := resource.Object{"id": c["id"], "name": c["name"], "description": c["description"], "name_i18n": c["name_i18n"], "description_i18n": c["description_i18n"], "authorization_mode": c["authorization_mode"], "authorization_method": c["authorization_method"], "auth_header_name": c["auth_header_name"], "icon_path": "", "capabilities": []string{"catalog", "invoke"}}
	if key := c.String("icon_s3_key"); key != "" {
		out["icon_path"] = "/api/v1/connectors/" + c.String("id") + "/icon?v=" + resource.Hash(key)
	}
	if c.String("authorization_mode") == "independent" {
		raw, err := resource.DecodeObjects(sqlc.New(q).ListCredentials(ctx, sqlc.ListCredentialsParams{ConnectorID: c.String("id"), UserID: user}))
		if err != nil {
			return nil, err
		}
		creds, err := credentialViews(ctx, q, c, raw...)
		if err != nil {
			return nil, err
		}
		for i, cred := range creds {
			// 自动刷新令牌的时间变化不影响公开目录版本。
			delete(cred, "updated_at")
			delete(cred, "oauth_expires_at")
			tools := []resource.Object{}
			if cred.String("authorization_status") == "authorized" {
				if includeTools {
					tools, err = s.catalogTools(ctx, q, c, raw[i], cred)
				}
				if err != nil {
					return nil, err
				}
				cred["mcp_gateway"] = s.gateway(c, cred.String("id"))
			}
			visible := safeTools(tools)
			cred["tools"], cred["tools_version"] = visible, resource.Hash(visible)
		}
		out["credentials"] = creds
		return out, nil
	}
	out["authorization_status"] = "not_required"
	out["connection_status"] = c["connection_status"]
	cred, err := s.Credential(ctx, q, c, user, "")
	if err != nil && !errors.Is(err, authorizationRequired) {
		return nil, err
	}
	if c.String("authorization_mode") == "centralized" {
		out["authorization_status"], out["connection_status"] = credentialStatus(c, cred), "unknown"
		if cred != nil {
			out["connection_status"] = cred["connection_status"]
			out["credential_id"] = cred["id"]
		}
	}
	tools := []resource.Object{}
	if c.String("authorization_mode") == "none" || credentialStatus(c, cred) == "authorized" {
		if includeTools {
			tools, err = s.catalogTools(ctx, q, c, cred, out)
		}
		if err != nil {
			return nil, err
		}
		out["mcp_gateway"] = s.gateway(c, cred.String("id"))
	}
	visible := safeTools(tools)
	out["tools"], out["tools_version"] = visible, resource.Hash(visible)
	return out, nil
}
