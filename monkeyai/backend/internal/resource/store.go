package resource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Object map[string]any

func (o Object) String(k string) string { v, _ := o[k].(string); return v }
func (o Object) Bool(k string) bool     { v, _ := o[k].(bool); return v }
func (o Object) Int(k string) int64     { v, _ := o[k].(float64); return int64(v) }
func ID() string                        { return uuid.New().String() }

func Hash(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		logging.Event(context.Background(), slog.Default(), slog.LevelError, "resource.operation.error", "资源内容哈希编码失败", "module", "resource", "operation", "Hash", "type", fmt.Sprintf("%T", v), "error", err)
	}
	h := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(h[:])
}
func Strings(v any) []string {
	result := []string{}
	b, err := json.Marshal(v)
	if err != nil {
		logging.Event(context.Background(), slog.Default(), slog.LevelError, "resource.operation.error", "资源字符串列表编码失败", "module", "resource", "operation", "Strings", "type", fmt.Sprintf("%T", v), "error", err)
		return result
	}
	if err := json.Unmarshal(b, &result); err != nil {
		logging.Event(context.Background(), slog.Default(), slog.LevelError, "resource.operation.error", "资源字符串列表解码失败", "module", "resource", "operation", "Strings", "error", err)
		return []string{}
	}
	if result == nil {
		return []string{}
	}
	return result
}

type Error struct {
	Status        int
	Code, Message string
	References    any
}

func (e *Error) Error() string { return e.Message }
func Invalid(message string) error {
	return &Error{Status: 400, Code: "invalid_request", Message: message}
}

var NotFound = &Error{Status: 404, Code: "not_found", Message: "资源不存在或无权访问"}
var Conflict = &Error{Status: 412, Code: "revision_conflict", Message: "资源已更新，请刷新后重试"}

func JSON(ctx context.Context, w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		if ctx.Err() == nil {
			logging.Diagnostic(ctx, slog.Default(), slog.LevelWarn, "http.response.failed", err, slog.Int("status", status))
		}
	}
}
func Fail(ctx context.Context, w http.ResponseWriter, err error) {
	var e *Error
	var pe *pgconn.PgError
	if !errors.As(err, &e) {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			e = NotFound
		case errors.As(err, &pe) && pe.Code == "23505":
			e = &Error{Status: 409, Code: "name_conflict", Message: "名称或关联已存在"}
		case errors.As(err, &pe) && (pe.Code == "23503" || pe.Code == "22P02" || pe.Code == "23514"):
			e = &Error{Status: 400, Code: "invalid_reference", Message: "字段或关联对象无效"}
		default:
			e = &Error{Status: 500, Code: "resource_error", Message: "资源操作失败"}
		}
	}
	if e.Status >= 500 && !logging.Diagnosed(ctx) && !logging.IsExpected(ctx) {
		event := "resource.operation.failed"
		if _, ok := logging.ContextField(ctx, "upload_id"); ok {
			event = "resource.upload.operation.failed"
			if _, ok := logging.ContextField(ctx, "chunk_index"); ok {
				event = "resource.upload.failed"
			}
		}
		logging.Diagnostic(ctx, slog.Default(), slog.LevelError, event, err)
	} else if e.Status < 500 {
		logging.Expected(ctx)
	}
	JSON(ctx, w, e.Status, Object{"error": Object{"code": e.Code, "message": e.Message, "references": e.References}})
}
func Decode(w http.ResponseWriter, r *http.Request, v any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	var body json.RawMessage
	if err := d.Decode(&body); err != nil {
		return Invalid("请求格式无效")
	}
	if data := bytes.TrimSpace(body); len(data) == 0 || data[0] != '{' {
		return Invalid("请求必须为 JSON 对象")
	}
	if err := d.Decode(new(json.RawMessage)); err != io.EOF {
		return Invalid("请求只能包含一个 JSON 对象")
	}
	if err := json.Unmarshal(body, v); err != nil {
		return Invalid("请求格式无效")
	}
	return nil
}
func ETag(w http.ResponseWriter, o Object) {
	w.Header().Set("ETag", fmt.Sprintf(`"%v"`, o["revision"]))
	w.Header().Set("Cache-Control", "private, no-cache")
}

type Queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}
type Store struct{ Pool *pgxpool.Pool }

func NewStore(p *pgxpool.Pool) *Store { return &Store{Pool: p} }
func CanUseSystem(ctx context.Context, q Queryer, user string) (bool, error) {
	return sqlc.New(q).CanUseSystem(ctx, user)
}

func Allowed(ctx context.Context, q Queryer, kind, id, user string) (bool, error) {
	ok, err := sqlc.New(q).HasAccess(ctx, sqlc.HasAccessParams{UserID: new(user), ResourceType: kind, ResourceID: id})

	return ok, err
}
func Grants(ctx context.Context, q Queryer, kind, id string) ([]Object, error) {
	grants, err := DecodeObjects(sqlc.New(q).ListGrants(ctx, sqlc.ListGrantsParams{ResourceType: kind, ResourceID: id}))
	if err != nil {
		return nil, err
	}
	for _, grant := range grants {
		if grant.Bool("all_users") {
			grant["group_id"] = rootgroup.ID
			grant["all_users"] = false
		}
	}
	return grants, nil
}
func SaveGrants(ctx context.Context, tx pgx.Tx, kind, id, actor string, raw any, personal bool) error {
	b, err := json.Marshal(raw)
	if err != nil {
		return fmt.Errorf("编码 %s 资源 %s 的授权: %w", kind, id, err)
	}
	var grants []struct {
		UserID   string `json:"user_id"`
		GroupID  string `json:"group_id"`
		AllUsers bool   `json:"all_users"`
		Usage    string `json:"usage_requirement"`
	}
	if err := json.Unmarshal(b, &grants); err != nil {
		return Invalid("授权格式无效")
	}
	if _, err := sqlc.New(tx).DeleteGrants(ctx, sqlc.DeleteGrantsParams{ResourceType: kind, ResourceID: id}); err != nil {
		return err
	}
	for _, g := range grants {
		if g.GroupID == rootgroup.ID && !g.AllUsers && g.UserID == "" {
			g.AllUsers, g.GroupID = true, ""
		}
		if g.AllUsers {
			if personal || g.UserID != "" || g.GroupID != "" {
				return Invalid("全员授权仅用于系统资源，且不能同时指定用户或分组")
			}
		} else if (g.UserID == "") == (g.GroupID == "") {
			return Invalid("每条授权必须指定一个用户、分组或全体用户")
		}
		if g.Usage == "" {
			g.Usage = "optional"
		}
		if g.Usage == "required" && (kind != "rule" || personal) {
			return Invalid("仅系统规则可以强制应用")
		}

		if !g.AllUsers {
			exists, err := sqlc.New(tx).SubjectExists(ctx, sqlc.SubjectExistsParams{UserID: g.UserID, GroupID: g.GroupID})
			if err != nil {
				return err
			}
			if !exists {
				return Invalid("授权对象不存在")
			}
		}
		if _, err := sqlc.New(tx).CreateGrant(ctx, sqlc.CreateGrantParams{
			ResourceType:     kind,
			ResourceID:       id,
			UserID:           g.UserID,
			GroupID:          g.GroupID,
			AllUsers:         g.AllUsers,
			UsageRequirement: g.Usage,
			GrantedByUserID:  actor,
		}); err != nil {
			return err
		}
	}
	return nil
}
func Audit(ctx context.Context, tx pgx.Tx, actor, kind, id, action string) error {
	category := "resource"
	if kind == "group" {
		category = "identity"
	}
	return audit.Write(ctx, tx, audit.Event{ActorID: actor, Action: action, Category: category, TargetType: kind, TargetID: id})
}

type Definition struct {
	Kind, Path      string
	Repository      func(Queryer) Repository
	Fields          []string
	UserFields      []string
	Hidden          []string
	OverrideFields  []string
	Validate        func(context.Context, pgx.Tx, Object, Object) error
	PrepareOverride func(context.Context, pgx.Tx, Object, Object) error
	Persist         func(context.Context, pgx.Tx, Object) error
	Decorate        func(context.Context, Queryer, Object) error
	UserDecorate    func(Object)
	References      func(context.Context, pgx.Tx, string) ([]Object, error)
}
type CRUD struct {
	Store *Store
	Def   Definition
}

func NewCRUD(s *Store, d Definition) *CRUD { return &CRUD{Store: s, Def: d} }
func (c *CRUD) Get(ctx context.Context, q Queryer, id string) (Object, error) {
	o, err := DecodeObject(c.Def.Repository(q).GetResource(ctx, id))
	if err != nil {
		return nil, err
	}
	return c.decorate(ctx, q, o)
}
func (c *CRUD) decorate(ctx context.Context, q Queryer, o Object) (Object, error) {
	imported, err := sqlc.New(q).GetResourceImport(ctx, sqlc.GetResourceImportParams{ResourceType: c.Def.Kind, ResourceID: o.String("id")})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		o["origin"], o["publisher"], o["source_slug"], o["retired"] = "package", imported.Publisher, imported.Slug, imported.Retired
	} else if o.String("ownership_type") == "system" {
		o["origin"] = "admin"
	} else {
		o["origin"] = "user"
	}
	g := []Object{}
	g, err = Grants(ctx, q, c.Def.Kind, o.String("id"))
	if err != nil {
		return nil, err
	}
	o["grants"] = g
	if o.String("ownership_type") == "user" {
		users, groups := []any{}, []any{}
		for _, grant := range g {
			if user := grant["user"]; user != nil {
				users = append(users, user)
			}
			if group := grant["group"]; group != nil {
				groups = append(groups, group)
			}
		}
		o["shared_users"] = users
		o["shared_groups"] = groups
	}
	if owner := o.String("owner_user_id"); owner != "" {
		users, err := Users(ctx, q, []string{owner})
		if err != nil {
			return nil, err
		}

		o["user"] = users[owner]
	}
	if c.Def.Kind == "expert" || c.Def.Kind == "connector" {
		o["tags"], err = Tags(ctx, q, c.Def.Kind, o.String("id"))
		if err != nil {
			return nil, err
		}
	}
	if c.Def.Decorate != nil {
		if err = c.Def.Decorate(ctx, q, o); err != nil {
			return nil, err
		}
	}
	for _, k := range c.Def.Hidden {
		delete(o, k)
	}
	delete(o, "owner_user_id")
	delete(o, "owner_name")
	return o, nil
}
func (c *CRUD) List(ctx context.Context, q Queryer) ([]Object, error) {
	out, err := DecodeObjects(c.Def.Repository(q).ListResources(ctx))
	if err != nil {
		return nil, err
	}
	for i, o := range out {
		out[i], err = c.decorate(ctx, q, o)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
func rollback(ctx context.Context, tx pgx.Tx, operation, id string) {
	if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		logging.Event(ctx, slog.Default(), slog.LevelError, "resource.operation.error", "回滚资源事务失败", "module", "resource", "operation", "rollback", "operation", operation, "resource_id", id, "error", err)
	}
}

func (c *CRUD) Save(ctx context.Context, actor, id, match string, in Object) (Object, error) {
	return c.save(ctx, actor, id, match, in, false)
}
func (c *CRUD) save(ctx context.Context, actor, id, match string, in Object, personal bool) (Object, error) {
	tx, err := c.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { rollback(ctx, tx, "save", id) }()
	old := Object{}
	create := id == ""
	if create {
		id = ID()
	} else {
		old, err = DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
		if err != nil {
			return nil, err
		}
		if personal && !owned(old, actor) {
			return nil, NotFound
		}
		imported, err := Imported(ctx, tx, c.Def.Kind, id)
		if err != nil {
			return nil, err
		}
		if imported {
			if personal {
				return nil, ImportedReadOnly
			}
			if old.String("ownership_type") == "user" {
				return nil, Invalid("个人资源仅允许治理删除")
			}
			if match == "" {
				return nil, &Error{Status: 428, Code: "precondition_required", Message: "更新需要 If-Match"}
			}
			if match != fmt.Sprintf(`"%v"`, old["revision"]) {
				return nil, Conflict
			}
			return c.override(ctx, tx, actor, id, in, old)
		}
		if err = RequireEditable(ctx, tx, c.Def.Kind, id); err != nil {
			return nil, err
		}
		if old.String("ownership_type") == "user" && !personal {
			return nil, Invalid("个人资源仅允许治理删除")
		}
		if match == "" {
			return nil, &Error{Status: 428, Code: "precondition_required", Message: "更新需要 If-Match"}
		}
		if match != fmt.Sprintf(`"%v"`, old["revision"]) {
			return nil, Conflict
		}
	}
	in["id"] = id
	in["actor_id"] = actor
	in["ownership_type"] = "system"
	if personal {
		in["ownership_type"] = "user"
		if slices.Contains(c.Def.Fields, "enabled") {
			in["enabled"] = true
			if !create {
				in["enabled"] = old["enabled"]
			}
		}
	}
	if name, ok := in["name"].(string); ok {
		in["name"] = strings.TrimSpace(name)
	}
	if in.String("name") == "" || len(in.String("name")) > 200 {
		return nil, Invalid("名称不能为空且不能超过 200 字节")
	}
	if c.Def.Validate != nil {
		if err = c.Def.Validate(ctx, tx, in, old); err != nil {
			return nil, err
		}
	}
	payload := Object{"id": id, "actor_id": actor, "ownership_type": in["ownership_type"]}
	for _, key := range c.Def.Fields {
		if value, ok := in[key]; ok {
			payload[key] = value
		}
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if create {
		err = c.Def.Repository(tx).CreateResource(ctx, data)
	} else {
		err = c.Def.Repository(tx).UpdateResource(ctx, data)
	}

	if err != nil {
		return nil, err
	}
	if grants, ok := in["grants"]; ok && !personal {
		if err = SaveGrants(ctx, tx, c.Def.Kind, id, actor, grants, false); err != nil {
			return nil, err
		}
	}
	if c.Def.Persist != nil {
		if err = c.Def.Persist(ctx, tx, in); err != nil {
			return nil, err
		}
	}
	if raw, ok := in["tag_ids"]; ok && (c.Def.Kind == "expert" || c.Def.Kind == "connector") {
		if err = SaveTags(ctx, tx, c.Def.Kind, id, actor, raw); err != nil {
			return nil, err
		}
	}
	if err = Audit(ctx, tx, actor, c.Def.Kind, id, "save"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	if personal {
		return c.GetUser(ctx, c.Store.Pool, id, actor)
	}
	return c.Get(ctx, c.Store.Pool, id)
}

// override updates the whitelisted fields of a package-managed resource and
// records the field names so a later package import leaves them untouched.
func (c *CRUD) override(ctx context.Context, tx pgx.Tx, actor, id string, in, old Object) (Object, error) {
	allowed := make(map[string]bool, len(c.Def.OverrideFields))
	for _, key := range c.Def.OverrideFields {
		allowed[key] = true
	}
	for key := range in {
		if key == "id" {
			continue
		}
		if !allowed[key] {
			return nil, Invalid("资源包导入的资源不允许修改字段：" + key)
		}
	}
	overrides := map[string]any{}
	if current, ok := old["admin_overrides"].(map[string]any); ok {
		for key := range current {
			overrides[key] = true
		}
	}
	changed := map[string]bool{}
	data := Object{"id": id, "actor_id": actor, "ownership_type": old.String("ownership_type")}
	if raw, ok := in["name"]; ok {
		name, isString := raw.(string)
		if !isString {
			return nil, Invalid("名称必须为字符串")
		}
		name = strings.TrimSpace(name)
		if name == "" || len(name) > 200 {
			return nil, Invalid("名称不能为空且不能超过 200 字节")
		}
		if name != old.String("name") {
			data["name"] = name
			// The administrator's value replaces package translations for every locale.
			data["name_i18n"] = Object{}
			overrides["name"], overrides["name_i18n"] = true, true
			changed["name"] = true
		}
	}
	if raw, ok := in["description"]; ok {
		description, isString := raw.(string)
		if !isString {
			return nil, Invalid("描述必须为字符串")
		}
		if description != old.String("description") {
			data["description"] = description
			data["description_i18n"] = Object{}
			overrides["description"], overrides["description_i18n"] = true, true
			changed["description"] = true
		}
	}
	for _, key := range c.Def.OverrideFields {
		if key == "name" || key == "description" || key == "tag_ids" {
			continue
		}
		value, ok := in[key]
		if !ok || Hash(value) == Hash(old[key]) {
			continue
		}
		data[key] = value
		overrides[key] = true
		changed[key] = true
	}
	tagsChanged := false
	if raw, ok := in["tag_ids"]; ok && allowed["tag_ids"] {
		current, err := Tags(ctx, tx, c.Def.Kind, id)
		if err != nil {
			return nil, err
		}
		currentIDs := make([]string, 0, len(current))
		for _, tag := range current {
			currentIDs = append(currentIDs, tag.String("id"))
		}
		tagsChanged = Hash(sortedStrings(Strings(raw))) != Hash(sortedStrings(currentIDs))
		if tagsChanged {
			data["tag_ids"] = raw
			overrides["tag_ids"] = true
		}
	}
	if len(changed) == 0 && !tagsChanged {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return c.Get(ctx, c.Store.Pool, id)
	}
	data["admin_overrides"] = overrides
	if c.Def.PrepareOverride != nil {
		if err := c.Def.PrepareOverride(ctx, tx, data, old); err != nil {
			return nil, err
		}
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	if err = c.Def.Repository(tx).UpdateResource(ctx, payload); err != nil {
		return nil, err
	}
	if tagsChanged {
		if err = SaveTags(ctx, tx, c.Def.Kind, id, actor, data["tag_ids"]); err != nil {
			return nil, err
		}
	}
	if err = Audit(ctx, tx, actor, c.Def.Kind, id, "override"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c.Get(ctx, c.Store.Pool, id)
}

func sortedStrings(values []string) []string {
	out := slices.Clone(values)
	slices.Sort(out)
	return out
}

func (c *CRUD) Delete(ctx context.Context, actor, id, match string) error {
	return c.delete(ctx, actor, id, match, false)
}
func (c *CRUD) delete(ctx context.Context, actor, id, match string, personal bool) error {
	tx, err := c.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { rollback(ctx, tx, "delete", id) }()
	o, err := DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
	if err != nil {
		return err
	}
	if personal && !owned(o, actor) {
		return NotFound
	}
	if err = RequireEditable(ctx, tx, c.Def.Kind, id); err != nil {
		return err
	}
	if personal && match == "" {
		return &Error{Status: 428, Code: "precondition_required", Message: "删除需要 If-Match"}
	}
	if match != fmt.Sprintf(`"%v"`, o["revision"]) {
		return Conflict
	}
	if c.Def.References != nil {
		refs, err := c.Def.References(ctx, tx, id)
		if err != nil {
			return err
		}
		if len(refs) > 0 {
			return &Error{Status: 409, Code: "reference_conflict", Message: "资源仍被引用", References: refs}
		}
	}
	if err = c.Def.Repository(tx).DeleteResource(ctx, id); err != nil {
		return err
	}
	if o.String("ownership_type") == "user" {
		if _, err = sqlc.New(tx).DeleteGrants(ctx, sqlc.DeleteGrantsParams{ResourceType: c.Def.Kind, ResourceID: id}); err != nil {
			return err
		}
	}
	if err = Audit(ctx, tx, actor, c.Def.Kind, id, "delete"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (c *CRUD) Register(r chi.Router) {
	path := c.Def.Path
	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		limit := 200
		if raw := r.URL.Query().Get("limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > 500 {
				Fail(r.Context(), w, Invalid("limit 必须在 1—500 之间"))
				return
			}
			limit = n
		}
		ownership := r.URL.Query().Get("ownership_type")
		if ownership != "" && ownership != "system" && ownership != "user" {
			Fail(r.Context(), w, Invalid("所有权类型无效"))
			return
		}
		filter, err := json.Marshal(Object{"ownership": ownership, "search": r.URL.Query().Get("q"), "cursor": r.URL.Query().Get("cursor"), "limit": limit + 1})
		if err != nil {
			Fail(r.Context(), w, err)
			return
		}
		items, err := DecodeObjects(c.Def.Repository(c.Store.Pool).PageResources(r.Context(), filter))
		if err != nil {
			Fail(r.Context(), w, err)
			return
		}
		cursor := ""
		if len(items) > limit {
			items = items[:limit]
			cursor = items[len(items)-1].String("id")
		}
		for i, o := range items {
			items[i], err = c.decorate(r.Context(), c.Store.Pool, o)
			if err != nil {
				Fail(r.Context(), w, err)
				return
			}
		}
		JSON(r.Context(), w, 200, Object{"items": items, "next_cursor": cursor})
	})

	r.Get(path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		o, err := c.Get(r.Context(), c.Store.Pool, chi.URLParam(r, "id"))
		if err != nil {
			Fail(r.Context(), w, err)
			return
		}
		ETag(w, o)
		JSON(r.Context(), w, 200, o)
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		var in Object
		if err := Decode(w, r, &in); err != nil {
			Fail(r.Context(), w, err)
			return
		}
		u, _ := identity.UserFromContext(r.Context())
		o, err := c.Save(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), in)
		if err != nil {
			Fail(r.Context(), w, err)
			return
		}
		ETag(w, o)
		JSON(r.Context(), w, 200, o)
	}
	r.Post(path, save)
	r.Put(path+"/{id}", save)
	if slices.Contains(c.Def.Fields, "enabled") {
		r.Patch(path+"/{id}/enabled", func(w http.ResponseWriter, r *http.Request) {
			var in Object
			if err := Decode(w, r, &in); err != nil {
				Fail(r.Context(), w, err)
				return
			}
			enabled, ok := in["enabled"].(bool)
			if !ok {
				Fail(r.Context(), w, Invalid("enabled 必须为布尔值"))
				return
			}
			u, _ := identity.UserFromContext(r.Context())
			o, err := c.SetEnabled(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), enabled)
			if err != nil {
				Fail(r.Context(), w, err)
				return
			}
			ETag(w, o)
			JSON(r.Context(), w, 200, o)
		})
	}

	r.Delete(path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		u, _ := identity.UserFromContext(r.Context())
		if err := c.Delete(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match")); err != nil {
			Fail(r.Context(), w, err)
			return
		}
		w.WriteHeader(204)
	})
}
func Accessible(ctx context.Context, q Queryer, kind string, o Object, user string) (bool, error) {
	if o == nil || o["deleted_at"] != nil {
		return false, nil
	}
	if v, ok := o["enabled"].(bool); ok && !v {
		return false, nil
	}
	if o.String("ownership_type") == "system" {
		ok, err := CanUseSystem(ctx, q, user)
		if err != nil || !ok {
			return false, err
		}
	}
	if o.String("ownership_type") == "user" && o.String("owner_user_id") == user {
		return true, nil
	}
	return Allowed(ctx, q, kind, o.String("id"), user)
}
func Stable(items []Object) {
	sort.Slice(items, func(i, j int) bool { return items[i].String("id") < items[j].String("id") })
}

func (c *CRUD) SetEnabled(ctx context.Context, actor, id, match string, enabled bool) (Object, error) {
	tx, err := c.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { rollback(ctx, tx, "set_enabled", id) }()
	o, err := DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
	if err != nil {
		return nil, err
	}
	if o.String("ownership_type") == "user" {
		return nil, Invalid("个人资源仅允许治理删除")
	}
	if err = RequireEditable(ctx, tx, c.Def.Kind, id); err != nil {
		return nil, err
	}
	if match != fmt.Sprintf(`"%v"`, o["revision"]) {
		return nil, Conflict
	}
	data, err := json.Marshal(Object{"id": id, "enabled": enabled})
	if err != nil {
		return nil, err
	}
	repository, ok := c.Def.Repository(tx).(interface {
		SetResourceEnabled(context.Context, []byte) error
	})
	if !ok {
		return nil, Invalid("资源不支持启停")
	}
	if err = repository.SetResourceEnabled(ctx, data); err != nil {
		return nil, err
	}
	if err = Audit(ctx, tx, actor, c.Def.Kind, id, "enabled"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c.Get(ctx, c.Store.Pool, id)
}
