package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc/connector"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type credentialSaveKey struct{}

type credentialInput struct {
	ID       string          `json:"id,omitempty"`
	Revision *int64          `json:"revision,omitempty"`
	Name     *string         `json:"name,omitempty"`
	Headers  json.RawMessage `json:"http_headers,omitempty"`
	Revoke   bool            `json:"revoke,omitempty"`
}

type credentialSave struct {
	input   credentialInput
	headers map[string]string
	testID  string
}

func parseConnectorSave(w http.ResponseWriter, r *http.Request) (resource.Object, *credentialSave, error) {
	var raw map[string]json.RawMessage
	if err := resource.Decode(w, r, &raw); err != nil {
		return nil, nil, err
	}
	if raw == nil {
		return nil, nil, resource.Invalid("连接器配置必须为 JSON 对象")
	}
	payload, provided := raw["credential"]
	delete(raw, "credential")
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, nil, err
	}
	in, err := resource.DecodeObject(data, nil)
	if err != nil || !provided {
		return in, nil, err
	}
	change := &credentialSave{}
	if bytes.Equal(bytes.TrimSpace(payload), []byte("null")) {
		return nil, nil, resource.InvalidCode("credential_input_required", "credential 必须为凭证配置对象")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&change.input); err != nil {
		return nil, nil, resource.InvalidCode("credential_input_required", "凭证配置无效")
	}
	input := &change.input
	if input.ID != "" {
		if _, err := uuid.Parse(input.ID); err != nil {
			return nil, nil, resource.InvalidCode("credential_input_required", "凭证 ID 无效")
		}
		if input.Revision == nil {
			return nil, nil, &resource.Error{Status: 428, Code: "precondition_required", Message: "更新凭证需要 revision"}
		}
	}
	if input.Revision != nil && (input.ID == "" || *input.Revision < 1) {
		return nil, nil, resource.InvalidCode("credential_input_required", "凭证 revision 无效")
	}
	if input.Revoke {
		if input.ID == "" || input.Name != nil || input.Headers != nil {
			return nil, nil, resource.InvalidCode("credential_input_required", "撤销凭证只接受 id、revision 和 revoke")
		}
	} else if input.Name == nil && input.Headers == nil {
		return nil, nil, resource.InvalidCode("credential_input_required", "请提供凭证名称或认证 Header")
	}
	if input.Name != nil {
		name, err := credentialName(*input.Name)
		if err != nil {
			return nil, nil, err
		}
		input.Name = &name
	}
	if input.Headers != nil {
		change.headers, err = decodeHeaderFields(input.Headers, true)
		if err != nil {
			return nil, nil, err
		}
	}
	return in, change, nil
}

// Header names are case-insensitive. Blank values retain existing secrets;
// names omitted from the submitted set are removed.
func resolveCredentialHeaders(headers map[string]string, old resource.Object) (map[string]string, error) {
	stored := map[string]string{}
	if old != nil {
		raw, err := json.Marshal(old["http_headers"])
		if err != nil {
			return nil, err
		}
		var values map[string]string
		if err := json.Unmarshal(raw, &values); err != nil {
			return nil, err
		}
		for key, value := range values {
			stored[strings.ToLower(key)] = value
		}
	}
	out := make(map[string]string, len(headers))
	for key, value := range headers {
		if value == "" {
			var exists bool
			value, exists = stored[strings.ToLower(key)]
			if !exists {
				return nil, resource.InvalidCode("credential_headers_invalid", "新增认证 Header 必须填写值")
			}
		}
		out[key] = value
	}
	return out, nil
}

// Credential input stays in request context, never in connector fields or package overrides.
func (s *Service) persistCredential(ctx context.Context, tx pgx.Tx, in resource.Object) (bool, error) {
	change, _ := ctx.Value(credentialSaveKey{}).(*credentialSave)
	if change == nil {
		return false, nil
	}
	c, err := resource.DecodeObject(connector.New(tx).GetResource(ctx, in.String("id")))
	if err != nil {
		return false, err
	}
	if err = manageCredential(c, true); err != nil {
		return false, err
	}
	input := change.input
	if input.Headers != nil && c.String("authorization_method") != "http_header" {
		return false, resource.InvalidCode("oauth_reauthorization_required", "OAuth 凭证通过授权流程更新")
	}
	q := sqlc.New(tx)
	old, err := resource.DecodeObject(q.GetCentralCredential(ctx, c.String("id")))
	if errors.Is(err, pgx.ErrNoRows) {
		old, err = nil, nil
	}
	if err != nil {
		return false, err
	}
	if input.ID != "" {
		if old == nil || old.String("id") != input.ID {
			return false, resource.NotFound
		}
		if _, err = q.LockCredential(ctx, input.ID); err != nil {
			return false, err
		}
		// The connector lock serializes edits with OAuth callbacks and credential changes.
		if input.Revision == nil || *input.Revision != old.Int("revision") {
			return false, resource.Conflict
		}
	} else if old != nil {
		return false, resource.Conflict
	}
	if input.Revoke || (input.Headers != nil && len(change.headers) == 0) {
		if old == nil {
			return false, nil
		}
		if err = q.RevokeCredential(ctx, input.ID); err == nil {
			_, err = q.InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: c.String("id"), CredentialID: input.ID})
		}
		if err != nil {
			return false, err
		}
		return true, resource.Audit(ctx, tx, in.String("actor_id"), "connector_credential", input.ID, "revoke")
	}
	data := resource.Object{"id": input.ID}
	if input.Name != nil {
		data["name"] = *input.Name
	}
	if input.Headers != nil {
		headers, err := resolveCredentialHeaders(change.headers, old)
		if err != nil {
			return false, err
		}
		data["http_headers"] = headers
		data["oauth_access_token"], data["oauth_refresh_token"], data["oauth_expires_at"] = "", "", nil
		data["auth_change"], data["config_revision"] = true, c.Int("config_revision")
	}
	create := old == nil
	if create {
		if input.Name == nil || (c.String("authorization_method") == "http_header" && input.Headers == nil) {
			return false, resource.InvalidCode("credential_input_required", "新增凭证需要名称，Header 凭证还需要认证 Header")
		}
		data["id"], data["connector_id"], data["user_id"], data["config_revision"] = resource.ID(), c.String("id"), "", c.Int("config_revision")
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return false, err
	}
	if create {
		_, err = q.CreateCredential(ctx, encoded)
	} else {
		_, err = q.UpdateCredential(ctx, encoded)
	}
	if err != nil {
		return false, err
	}
	if input.Headers != nil {
		if _, err = q.InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: c.String("id"), CredentialID: data.String("id")}); err != nil {
			return false, err
		}
		change.testID = data.String("id")
	}
	return true, resource.Audit(ctx, tx, in.String("actor_id"), "connector_credential", data.String("id"), "save")
}

func (s *Service) saveConnector(w http.ResponseWriter, r *http.Request) {
	in, change, err := parseConnectorSave(w, r)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	actor, _ := identity.UserFromContext(r.Context())
	id := chi.URLParam(r, "id")
	if change != nil && id != "" {
		if _, provided := in["name"]; !provided {
			old, readErr := resource.DecodeObject(connector.New(s.Store.Pool).GetResource(r.Context(), id))
			if readErr != nil {
				resource.Fail(r.Context(), w, readErr)
				return
			}
			in["name"] = old["name"]
		}
	}
	ctx := r.Context()
	if change != nil {
		ctx = context.WithValue(ctx, credentialSaveKey{}, change)
	}
	out, err := s.Connectors.Save(ctx, actor.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), in)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if change != nil && change.testID != "" && out.Bool("enabled") {
		check, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
		defer cancel()
		c, readErr := s.Connector(check, s.Store.Pool, out.String("id"), actor.ID, true)
		if readErr == nil {
			cred, credErr := s.Credential(check, s.Store.Pool, c, actor.ID, change.testID)
			if credErr == nil {
				if _, testErr := s.testConnection(check, c, cred, actor.ID, true); testErr != nil {
					slog.WarnContext(check, "保存连接器凭证后连接测试失败", "module", "mcp", "connector_id", out.String("id"), "credential_id", change.testID, "error", testErr)
				}
			}
		}
		// Return persisted metadata even if the remote test fails; never expose secrets.
		if updated, readErr := s.Connectors.Get(check, s.Store.Pool, out.String("id")); readErr == nil {
			out = updated
		}
	}
	resource.ETag(w, out)
	w.Header().Set("Cache-Control", "private, no-store")
	resource.JSON(r.Context(), w, http.StatusOK, out)
}
