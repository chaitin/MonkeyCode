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

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
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
func Rows(ctx context.Context, q Queryer, sql string, args ...any) ([]Object, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Object{}
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		var o Object
		if err := json.Unmarshal(b, &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func Row(ctx context.Context, q Queryer, sql string, args ...any) (Object, error) {
	var b []byte
	if err := q.QueryRow(ctx, sql, args...).Scan(&b); err != nil {
		return nil, err
	}
	var o Object
	err := json.Unmarshal(b, &o)
	return o, err
}

// 用户仅属于显式加入的分组及其未删除的上级分组。
const GroupsSQL = `WITH RECURSIVE user_groups(group_id) AS (
 SELECT id FROM groups WHERE deleted_at IS NULL AND id IN (SELECT group_id FROM group_users WHERE user_id=$1 AND removed_at IS NULL)
 UNION SELECT parent.id FROM groups g JOIN user_groups ug ON ug.group_id=g.id JOIN groups parent ON parent.id=g.parent_id WHERE g.deleted_at IS NULL AND parent.deleted_at IS NULL
) `

func Allowed(ctx context.Context, q Queryer, kind, id, user string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, GroupsSQL+`SELECT EXISTS(SELECT 1 FROM resource_access_grants WHERE resource_type=$2 AND resource_id=$3 AND (user_id=$1 OR group_id IN (SELECT group_id FROM user_groups)))`, user, kind, id).Scan(&ok)
	return ok, err
}
func Grants(ctx context.Context, q Queryer, kind, id string) ([]Object, error) {
	return Rows(ctx, q, `SELECT jsonb_build_object('user_id',user_id,'group_id',group_id,'usage_requirement',usage_requirement) FROM resource_access_grants WHERE resource_type=$1 AND resource_id=$2 ORDER BY group_id,user_id`, kind, id)
}
func SaveGrants(ctx context.Context, tx pgx.Tx, kind, id, actor string, raw any, personal bool) error {
	b, _ := json.Marshal(raw)
	var grants []struct {
		UserID  string `json:"user_id"`
		GroupID string `json:"group_id"`
		Usage   string `json:"usage_requirement"`
	}
	if err := json.Unmarshal(b, &grants); err != nil {
		return Invalid("授权格式无效")
	}
	if _, err := tx.Exec(ctx, `DELETE FROM resource_access_grants WHERE resource_type=$1 AND resource_id=$2`, kind, id); err != nil {
		return err
	}
	for _, g := range grants {
		if (g.UserID == "") == (g.GroupID == "") {
			return Invalid("每条授权必须指定一个用户或分组")
		}
		if g.Usage == "" {
			g.Usage = "optional"
		}
		if g.Usage == "required" && (kind != "rule" || personal) {
			return Invalid("仅系统规则可以强制应用")
		}
		var exists bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=NULLIF($1,'')::uuid AND deleted_at IS NULL AND status='active') OR EXISTS(SELECT 1 FROM groups WHERE id=NULLIF($2,'')::uuid AND deleted_at IS NULL)`, g.UserID, g.GroupID).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return Invalid("授权对象不存在")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,group_id,access_level,usage_requirement,granted_by_user_id) VALUES($1,$2,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,'read_only',$5,$6)`, kind, id, g.UserID, g.GroupID, g.Usage, actor); err != nil {
			return err
		}
	}
	return nil
}
func Audit(ctx context.Context, tx pgx.Tx, actor, kind, id, action string) error {
	_, err := tx.Exec(ctx, `INSERT INTO audits(actor_type,actor_user_id,actor_name,actor_email,action,category,target_type,target_id,result,occurred_at) SELECT 'user',id,name,email,$2,'resource',$3,$4,'success',now() FROM users WHERE id=$1`, actor, action, kind, id)
	return err
}

type Definition struct {
	Kind, Table, Path string
	Fields            []string
	Hidden            []string
	Validate          func(context.Context, pgx.Tx, Object, Object) error
	Persist           func(context.Context, pgx.Tx, Object) error
	Decorate          func(context.Context, Queryer, Object) error
	References        func(context.Context, pgx.Tx, string) ([]Object, error)
}
type CRUD struct {
	Store *Store
	Def   Definition
}

func NewCRUD(s *Store, d Definition) *CRUD { return &CRUD{Store: s, Def: d} }
func (c *CRUD) Get(ctx context.Context, q Queryer, id string) (Object, error) {
	o, err := Row(ctx, q, `SELECT to_jsonb(t) FROM `+c.Def.Table+` t WHERE id=$1 AND deleted_at IS NULL`, id)
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
		var name string
		if err := q.QueryRow(ctx, `SELECT name FROM users WHERE id=$1`, owner).Scan(&name); err != nil {
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
	out, err := Rows(ctx, q, `SELECT to_jsonb(t) FROM `+c.Def.Table+` t WHERE deleted_at IS NULL ORDER BY lower(name),id`)
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
		old, err = Row(ctx, tx, `SELECT to_jsonb(t) FROM `+c.Def.Table+` t WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id)
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
	fields := []string{}
	args := []any{}
	for _, k := range c.Def.Fields {
		v, ok := in[k]
		if !ok {
			continue
		}
		fields = append(fields, k)
		args = append(args, v)
	}
	if create {
		fields = append(fields, "id")
		args = append(args, id)
		if c.Def.Table == "experts" {
			fields = append(fields, "created_by_user_id")
		} else {
			fields = append(fields, "owner_user_id")
		}
		args = append(args, actor)
		if c.Def.Table != "experts" {
			fields = append(fields, "ownership_type")
			args = append(args, "system")
		}
		marks := []string{}
		for i := range args {
			marks = append(marks, fmt.Sprintf("$%d", i+1))
		}
		_, err = tx.Exec(ctx, `INSERT INTO `+c.Def.Table+` (`+strings.Join(fields, ",")+`) VALUES (`+strings.Join(marks, ",")+`)`, args...)
	} else {
		sets := []string{}
		for i, k := range fields {
			sets = append(sets, fmt.Sprintf("%s=$%d", k, i+1))
		}
		args = append(args, id)
		sets = append(sets, "revision=revision+1", "updated_at=now()")
		_, err = tx.Exec(ctx, `UPDATE `+c.Def.Table+` SET `+strings.Join(sets, ",")+fmt.Sprintf(" WHERE id=$%d", len(args)), args...)
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
	o, err := Row(ctx, tx, `SELECT to_jsonb(t) FROM `+c.Def.Table+` t WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id)
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
	if _, err = tx.Exec(ctx, `UPDATE `+c.Def.Table+` SET deleted_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1`, id); err != nil {
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
		ownerColumn := "t.ownership_type"
		if c.Def.Table == "experts" {
			ownerColumn = "'system'"
		}
		items, err := Rows(r.Context(), c.Store.Pool, `SELECT to_jsonb(t) FROM `+c.Def.Table+` t WHERE deleted_at IS NULL AND ($1='' OR `+ownerColumn+`=$1) AND name ILIKE '%'||$2||'%' AND id::text>$3 ORDER BY id LIMIT $4`, ownership, r.URL.Query().Get("q"), r.URL.Query().Get("cursor"), limit+1)
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
	o, err := Row(ctx, tx, `SELECT to_jsonb(t) FROM `+c.Def.Table+` t WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id)
	if err != nil {
		return nil, err
	}
	if o.String("ownership_type") == "user" {
		return nil, Invalid("个人资源仅允许治理删除")
	}
	if match != fmt.Sprintf(`"%v"`, o["revision"]) {
		return nil, Conflict
	}
	if _, err = tx.Exec(ctx, `UPDATE `+c.Def.Table+` SET enabled=$2,updated_at=now(),revision=revision+1 WHERE id=$1`, id, enabled); err != nil {
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
