package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

var authorizationRequired = &resource.Error{Status: 403, Code: "authorization_required", Message: "请先完成所选凭证的认证"}
var selectionRequired = &resource.Error{Status: 400, Code: "credential_selection_required", Message: "请选择此连接使用的凭证"}

func credentialStatus(c, cred resource.Object) string {
	if cred == nil {
		return "authorization_required"
	}
	if cred["revoked_at"] != nil {
		return "revoked"
	}
	if c.Int("config_revision") != cred.Int("config_revision") {
		return "authorization_required"
	}
	if c.String("authorization_method") == "http_header" {
		b, _ := json.Marshal(cred["http_headers"])
		if _, err := decodeHeaders(b); err == nil {
			return "authorized"
		}
	} else if cred.String("oauth_refresh_token") != "" || (cred.String("oauth_access_token") != "" && tokenFresh(cred, 0)) {
		return "authorized"
	}
	return "authorization_required"
}
func tokenFresh(cred resource.Object, window time.Duration) bool {
	if cred.String("oauth_access_token") == "" {
		return false
	}
	if cred["oauth_expires_at"] == nil {
		return true
	}
	expires, err := time.Parse(time.RFC3339Nano, cred.String("oauth_expires_at"))
	return err == nil && expires.After(time.Now().Add(window))
}
func credentialView(c, cred resource.Object, users map[string]resource.User) resource.Object {
	out := resource.Object{}
	for _, key := range []string{"id", "connector_id", "name", "revision", "config_revision", "connection_status", "last_checked_at", "last_error", "oauth_expires_at", "created_at", "updated_at", "revoked_at"} {
		out[key] = cred[key]
	}
	out["user"] = nil
	if user, ok := users[cred.String("user_id")]; ok {
		out["user"] = user
	}
	out["authorization_status"] = credentialStatus(c, cred)
	names := []string{}
	if headers, ok := cred["http_headers"].(map[string]any); ok {
		for name := range headers {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	out["header_names"] = names
	return out
}
func credentialViews(ctx context.Context, q resource.Queryer, c resource.Object, creds ...resource.Object) ([]resource.Object, error) {
	ids := []string{}
	for _, cred := range creds {
		if id := cred.String("user_id"); id != "" && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	users, err := resource.Users(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	out := make([]resource.Object, 0, len(creds))
	for _, cred := range creds {
		out = append(out, credentialView(c, cred, users))
	}
	return out, nil
}
func (s *Service) Credentials(ctx context.Context, q resource.Queryer, c resource.Object, user string) ([]resource.Object, error) {
	if c.String("authorization_mode") == "none" {
		return []resource.Object{}, nil
	}
	if c.String("authorization_mode") == "centralized" {
		user = ""
	}
	creds, err := resource.DecodeObjects(sqlc.New(q).ListCredentials(ctx, sqlc.ListCredentialsParams{ConnectorID: c.String("id"), UserID: user}))
	if err != nil {
		return nil, err
	}
	return credentialViews(ctx, q, c, creds...)
}
func (s *Service) Credential(ctx context.Context, q resource.Queryer, c resource.Object, user, id string) (resource.Object, error) {
	mode := c.String("authorization_mode")
	if mode == "none" {
		if id != "" {
			return nil, resource.NotFound
		}
		return nil, nil
	}
	if mode == "centralized" {
		user = ""
	} else if id == "" {
		return nil, selectionRequired
	}
	var cred resource.Object
	var err error
	if id == "" {
		cred, err = resource.DecodeObject(sqlc.New(q).GetCentralCredential(ctx, c.String("id")))
	} else {
		cred, err = resource.DecodeObject(sqlc.New(q).GetCredential(ctx, sqlc.GetCredentialParams{ID: id, ConnectorID: c.String("id")}))
	}
	if errors.Is(err, pgx.ErrNoRows) && id == "" {
		return nil, authorizationRequired
	}
	if err != nil {
		return nil, err
	}
	if cred.String("user_id") != user {
		return nil, resource.NotFound
	}
	return cred, nil
}
func manageCredential(c resource.Object, admin bool) error {
	mode := c.String("authorization_mode")
	if (admin && mode != "centralized") || (!admin && mode != "independent") {
		return resource.Invalid("当前调用方不能管理此认证上下文")
	}
	return nil
}
func matchCredential(r *http.Request, cred resource.Object) error {
	if r.Header.Get("If-Match") == "" {
		return &resource.Error{Status: 428, Code: "precondition_required", Message: "更新需要 If-Match"}
	}
	if r.Header.Get("If-Match") != fmt.Sprintf(`"%v"`, cred["revision"]) {
		return resource.Conflict
	}
	return nil
}
func credentialName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 128 {
		return "", resource.Invalid("凭证名称须为 1—128 个字符")
	}
	return name, nil
}
func decodeHeaders(raw []byte) (map[string]string, error) {
	invalid := resource.Invalid("认证 Header 无效，请检查名称、数量和保留字段")
	d := json.NewDecoder(bytes.NewReader(raw))
	first, err := d.Token()
	if err != nil || first != json.Delim('{') {
		return nil, invalid
	}
	out, seen := map[string]string{}, map[string]bool{}
	reserved := []string{"host", "content-length", "connection", "transfer-encoding", "trailer", "te", "upgrade", "keep-alive", "proxy-authorization", "proxy-authenticate", "content-type", "accept"}
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || key == "" || len(key) > 256 {
			return nil, invalid
		}
		for _, ch := range key {
			if !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", ch)) {
				return nil, invalid
			}
		}
		lower := strings.ToLower(key)
		if seen[lower] || slices.Contains(reserved, lower) || strings.HasPrefix(lower, "mcp-") {
			return nil, invalid
		}
		var rawValue any
		if d.Decode(&rawValue) != nil {
			return nil, invalid
		}
		value, ok := rawValue.(string)
		if !ok || len(value) > 16384 {
			return nil, invalid
		}
		for _, ch := range value {
			if ch == '\r' || ch == '\n' || ch == 127 || (ch < 32 && ch != '\t') {
				return nil, invalid
			}
		}
		out[key], seen[lower] = value, true
		if len(out) > 30 {
			return nil, invalid
		}
	}
	if _, err := d.Token(); err != nil || len(out) == 0 {
		return nil, invalid
	}
	if _, err := d.Token(); err != io.EOF {
		return nil, invalid
	}
	return out, nil
}
func (s *Service) credentialRoutes(r chi.Router, admin bool) {
	for _, path := range []string{"/connectors/{id}/credentials", "/connectors/{id}/credentials/{credentialID}"} {
		r.Get(path, func(w http.ResponseWriter, r *http.Request) { s.readCredentials(w, r, admin) })
	}
	r.Post("/connectors/{id}/credentials", func(w http.ResponseWriter, r *http.Request) { s.saveCredential(w, r, admin) })
	r.Patch("/connectors/{id}/credentials/{credentialID}", func(w http.ResponseWriter, r *http.Request) { s.saveCredential(w, r, admin) })
	r.Delete("/connectors/{id}/credentials/{credentialID}", func(w http.ResponseWriter, r *http.Request) { s.saveCredential(w, r, admin) })
}
func (s *Service) readCredentials(w http.ResponseWriter, r *http.Request, admin bool) {
	u, _ := identity.UserFromContext(r.Context())
	c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, admin)
	if err == nil {
		err = manageCredential(c, admin)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if id := chi.URLParam(r, "credentialID"); id != "" {
		cred, err := s.Credential(r.Context(), s.Store.Pool, c, u.ID, id)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		out, err := credentialViews(r.Context(), s.Store.Pool, c, cred)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.ETag(w, cred)
		w.Header().Set("Cache-Control", "private, no-store")
		resource.JSON(w, 200, out[0])
		return
	}
	creds, err := s.Credentials(r.Context(), s.Store.Pool, c, u.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, resource.Object{"items": creds})
}
func (s *Service) saveCredential(w http.ResponseWriter, r *http.Request, admin bool) {
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
	id := chi.URLParam(r, "credentialID")
	if id != "" {
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
	}
	queries := sqlc.New(tx)
	if r.Method == http.MethodDelete {
		err = queries.RevokeCredential(ctx, id)
		if err == nil {
			_, err = queries.InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: c.String("id"), CredentialID: id})
		}
		if err == nil {
			err = resource.Audit(ctx, tx, u.ID, "connector_credential", id, "revoke")
		}
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			resource.Fail(w, err)
			return
		}
		w.WriteHeader(204)
		return
	}
	var in struct {
		Name    *string         `json:"name"`
		Headers json.RawMessage `json:"http_headers"`
	}
	if err = resource.Decode(w, r, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	data := resource.Object{"id": id}
	if in.Name != nil {
		data["name"], err = credentialName(*in.Name)
		if err != nil {
			resource.Fail(w, err)
			return
		}
	}
	if in.Headers != nil {
		if c.String("authorization_method") != "http_header" {
			resource.Fail(w, resource.Invalid("OAuth 凭证通过授权流程更新"))
			return
		}
		data["http_headers"], err = decodeHeaders(in.Headers)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		data["oauth_access_token"], data["oauth_refresh_token"], data["oauth_expires_at"] = "", "", nil
		data["auth_change"], data["config_revision"] = true, c.Int("config_revision")
	}
	if id == "" {
		if in.Name == nil || in.Headers == nil {
			resource.Fail(w, resource.Invalid("新增 Header 凭证需要名称和认证 Header"))
			return
		}
		id = resource.ID()
		data["id"], data["connector_id"], data["user_id"] = id, c.String("id"), u.ID
		if admin {
			data["user_id"] = ""
		}
	} else if in.Name == nil && in.Headers == nil {
		resource.Fail(w, resource.Invalid("请提供凭证名称或认证 Header"))
		return
	}
	b, _ := json.Marshal(data)
	var out resource.Object
	if r.Method == http.MethodPost {
		out, err = resource.DecodeObject(queries.CreateCredential(ctx, b))
	} else {
		out, err = resource.DecodeObject(queries.UpdateCredential(ctx, b))
	}
	if err == nil && in.Headers != nil {
		_, err = queries.InvalidateTools(ctx, sqlc.InvalidateToolsParams{ConnectorID: c.String("id"), CredentialID: id})
	}
	if err == nil {
		err = resource.Audit(ctx, tx, u.ID, "connector_credential", id, "save")
	}
	if err == nil {
		var views []resource.Object
		views, err = credentialViews(ctx, tx, c, out)
		if err == nil {
			out = views[0]
		}
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.ETag(w, out)
	w.Header().Set("Cache-Control", "private, no-store")
	status := 200
	if r.Method == http.MethodPost {
		status = 201
	}
	resource.JSON(w, status, out)
}
