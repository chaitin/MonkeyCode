package resource

import (
	"bytes"
	"context"
	"crypto/rand"
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

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Object map[string]any

func (o Object) String(k string) string { v, _ := o[k].(string); return v }
func (o Object) Bool(k string) bool     { v, _ := o[k].(bool); return v }
func (o Object) Int(k string) int64     { v, _ := o[k].(float64); return int64(v) }
func ID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func Hash(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(h[:])
}
func Strings(v any) []string {
	result := []string{}
	b, _ := json.Marshal(v)
	_ = json.Unmarshal(b, &result)
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

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func Fail(w http.ResponseWriter, err error) {
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
			slog.Error("资源操作失败", "error", err)
			e = &Error{Status: 500, Code: "resource_error", Message: "资源操作失败"}
		}
	}
	JSON(w, e.Status, Object{"error": Object{"code": e.Code, "message": e.Message, "references": e.References}})
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
func Allowed(ctx context.Context, q Queryer, kind, id, user string) (bool, error) {
	ok, err := sqlc.New(q).HasAccess(ctx, sqlc.HasAccessParams{UserID: new(user), ResourceType: kind, ResourceID: id})

	return ok, err
}
func Grants(ctx context.Context, q Queryer, kind, id string) ([]Object, error) {
	return DecodeObjects(sqlc.New(q).ListGrants(ctx, sqlc.ListGrantsParams{ResourceType: kind, ResourceID: id}))
}
func SaveGrants(ctx context.Context, tx pgx.Tx, kind, id, actor string, raw any, personal bool) error {
	b, _ := json.Marshal(raw)
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
	Kind, Path string
	Repository func(Queryer) Repository
	Fields     []string
	Hidden     []string
	Validate   func(context.Context, pgx.Tx, Object, Object) error
	Persist    func(context.Context, pgx.Tx, Object) error
	Decorate   func(context.Context, Queryer, Object) error
	References func(context.Context, pgx.Tx, string) ([]Object, error)
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
	g, err := Grants(ctx, q, c.Def.Kind, o.String("id"))
	if err != nil {
		return nil, err
	}
	o["grants"] = g
	if owner := o.String("owner_user_id"); owner != "" {
		name, err := sqlc.New(q).GetOwnerName(ctx, owner)
		if err != nil {
			return nil, err
		}

		o["owner_name"] = name
	}
	if c.Def.Decorate != nil {
		if err = c.Def.Decorate(ctx, q, o); err != nil {
			return nil, err
		}
	}
	for _, k := range c.Def.Hidden {
		delete(o, k)
	}
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
func (c *CRUD) Save(ctx context.Context, actor, id, match string, in Object) (Object, error) {
	tx, err := c.Store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	old := Object{}
	create := id == ""
	if create {
		id = ID()
	} else {
		old, err = DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
		if err != nil {
			return nil, err
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
	}
	in["id"] = id
	in["actor_id"] = actor
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
	payload := Object{"id": id, "actor_id": actor}
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
	if grants, ok := in["grants"]; ok {
		if err = SaveGrants(ctx, tx, c.Def.Kind, id, actor, grants, false); err != nil {
			return nil, err
		}
	}
	if c.Def.Persist != nil {
		if err = c.Def.Persist(ctx, tx, in); err != nil {
			return nil, err
		}
	}
	if err = Audit(ctx, tx, actor, c.Def.Kind, id, "save"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c.Get(ctx, c.Store.Pool, id)
}
func (c *CRUD) Delete(ctx context.Context, actor, id, match string) error {
	tx, err := c.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	o, err := DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
	if err != nil {
		return err
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
			if err != nil || n < 1 || n > 200 {
				Fail(w, Invalid("limit 必须在 1—200 之间"))
				return
			}
			limit = n
		}
		ownership := r.URL.Query().Get("ownership_type")
		if ownership != "" && ownership != "system" && ownership != "user" {
			Fail(w, Invalid("所有权类型无效"))
			return
		}
		filter, err := json.Marshal(Object{"ownership": ownership, "search": r.URL.Query().Get("q"), "cursor": r.URL.Query().Get("cursor"), "limit": limit + 1})
		if err != nil {
			Fail(w, err)
			return
		}
		items, err := DecodeObjects(c.Def.Repository(c.Store.Pool).PageResources(r.Context(), filter))
		if err != nil {
			Fail(w, err)
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
				Fail(w, err)
				return
			}
		}
		JSON(w, 200, Object{"items": items, "next_cursor": cursor})
	})

	r.Get(path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		o, err := c.Get(r.Context(), c.Store.Pool, chi.URLParam(r, "id"))
		if err != nil {
			Fail(w, err)
			return
		}
		ETag(w, o)
		JSON(w, 200, o)
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		var in Object
		if err := Decode(w, r, &in); err != nil {
			Fail(w, err)
			return
		}
		u, _ := identity.UserFromContext(r.Context())
		o, err := c.Save(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), in)
		if err != nil {
			Fail(w, err)
			return
		}
		ETag(w, o)
		JSON(w, 200, o)
	}
	r.Post(path, save)
	r.Put(path+"/{id}", save)
	if slices.Contains(c.Def.Fields, "enabled") {
		r.Patch(path+"/{id}/enabled", func(w http.ResponseWriter, r *http.Request) {
			var in Object
			if err := Decode(w, r, &in); err != nil {
				Fail(w, err)
				return
			}
			enabled, ok := in["enabled"].(bool)
			if !ok {
				Fail(w, Invalid("enabled 必须为布尔值"))
				return
			}
			u, _ := identity.UserFromContext(r.Context())
			o, err := c.SetEnabled(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), enabled)
			if err != nil {
				Fail(w, err)
				return
			}
			ETag(w, o)
			JSON(w, 200, o)
		})
	}

	r.Delete(path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		u, _ := identity.UserFromContext(r.Context())
		if err := c.Delete(r.Context(), u.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match")); err != nil {
			Fail(w, err)
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
	if o.String("ownership_type") == "user" && o.String("owner_user_id") == user {
		return true, nil
	}
	if kind == "connector" && o.String("ownership_type") == "user" {
		return false, nil
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
	defer tx.Rollback(ctx)
	o, err := DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
	if err != nil {
		return nil, err
	}
	if o.String("ownership_type") == "user" {
		return nil, Invalid("个人资源仅允许治理删除")
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
