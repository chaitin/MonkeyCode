package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type group struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id"`
	Name     string  `json:"name"`
}

func (s *Service) registerGroups(r chi.Router) {
	r.Get("/groups", s.listGroups)
	r.Post("/groups", s.saveGroup)
	r.Patch("/groups/{groupID}", s.saveGroup)
	r.Delete("/groups/{groupID}", s.deleteGroup)
	r.Put("/users/{userID}/billing-group", s.billingGroup)
	r.Put("/groups/{groupID}/members", s.groupMembers)
}
func (s *Service) listGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT id,parent_id,name FROM groups WHERE deleted_at IS NULL ORDER BY name,id`)
	if err != nil {
		writeError(w, 500, "group_error", "读取分组失败")
		return
	}
	defer rows.Close()
	groups := []group{}
	for rows.Next() {
		var g group
		if err = rows.Scan(&g.ID, &g.ParentID, &g.Name); err != nil {
			writeError(w, 500, "group_error", "读取分组失败")
			return
		}
		groups = append(groups, g)
	}
	if rows.Err() != nil {
		writeError(w, 500, "group_error", "读取分组失败")
		return
	}
	memberships := []map[string]string{}
	rel, err := s.db.Query(r.Context(), `SELECT group_id,user_id FROM group_users WHERE removed_at IS NULL`)
	if err != nil {
		writeError(w, 500, "group_error", "读取成员关系失败")
		return
	}
	defer rel.Close()
	for rel.Next() {
		var g, u string
		if err = rel.Scan(&g, &u); err != nil {
			writeError(w, 500, "group_error", "读取成员关系失败")
			return
		}
		memberships = append(memberships, map[string]string{"group_id": g, "user_id": u})
	}
	if rel.Err() != nil {
		writeError(w, 500, "group_error", "读取成员关系失败")
		return
	}
	writeJSON(w, 200, map[string]any{"groups": groups, "memberships": memberships})
}
func groupInput(w http.ResponseWriter, r *http.Request, v any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	d.DisallowUnknownFields()
	return d.Decode(v)
}
func (s *Service) groupTx(r *http.Request) (pgx.Tx, error) {
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(741209)`); err != nil {
		tx.Rollback(r.Context())
		return nil, err
	}
	if s.accounts != nil {
		if err = s.accounts.PreserveAccounts(r.Context(), tx); err != nil {
			tx.Rollback(r.Context())
			return nil, err
		}
	}
	return tx, nil
}
func groupAudit(ctx context.Context, tx pgx.Tx, user User, action, id string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audits(actor_type,actor_user_id,actor_name,actor_email,action,category,target_type,target_id,request_params,result,occurred_at) VALUES('user',$1,$2,$3,$4,'identity','group',$5,$6,'success',now())`, user.ID, user.Name, user.Email, action, id, b)
	return err
}
func (s *Service) saveGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     string `json:"name"`
		ParentID string `json:"parent_id"`
	}
	if groupInput(w, r, &in) != nil || strings.TrimSpace(in.Name) == "" || len(in.Name) > 100 || in.ParentID == "" {
		writeError(w, 400, "invalid_group", "请填写分组名称和父分组")
		return
	}
	ctx := r.Context()
	id := chi.URLParam(r, "groupID")
	if id == "00000000-0000-0000-0000-000000000001" || id == "00000000-0000-0000-0000-000000000002" {
		writeError(w, 409, "fixed_group", "系统分组不可改动")
		return
	}
	tx, err := s.groupTx(r)
	if err != nil {
		writeError(w, 500, "group_error", "保存分组失败")
		return
	}
	defer tx.Rollback(ctx)
	var parent string
	err = tx.QueryRow(ctx, `SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL`, in.ParentID).Scan(&parent)
	if err != nil {
		writeError(w, 400, "invalid_parent", "父分组无效")
		return
	}
	if id != "" {
		var cycle bool
		err = tx.QueryRow(ctx, `WITH RECURSIVE children AS (SELECT id FROM groups WHERE id=$1 UNION SELECT g.id FROM groups g JOIN children c ON g.parent_id=c.id WHERE g.deleted_at IS NULL) SELECT EXISTS(SELECT 1 FROM children WHERE id=$2)`, id, in.ParentID).Scan(&cycle)
		if err != nil || cycle {
			writeError(w, 400, "group_cycle", "不能移动到自身或后代分组")
			return
		}
	}
	u, _ := UserFromContext(ctx)
	if id == "" {
		err = tx.QueryRow(ctx, `INSERT INTO groups(name,parent_id,created_by_user_id) VALUES($1,$2,$3) RETURNING id`, strings.TrimSpace(in.Name), in.ParentID, u.ID).Scan(&id)
	} else {
		err = tx.QueryRow(ctx, `UPDATE groups SET name=$2,parent_id=$3,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, id, strings.TrimSpace(in.Name), in.ParentID).Scan(&id)
	}
	if err == nil {
		err = groupAudit(ctx, tx, u, "save_group", id, in)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		writeError(w, 400, "group_error", "保存分组失败，请检查字段")
		return
	}
	writeJSON(w, 200, map[string]string{"id": id})
}
func (s *Service) deleteGroup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "groupID")
	if id == "00000000-0000-0000-0000-000000000001" || id == "00000000-0000-0000-0000-000000000002" {
		writeError(w, 409, "fixed_group", "系统分组不可删除")
		return
	}
	ctx := r.Context()
	tx, err := s.groupTx(r)
	if err != nil {
		writeError(w, 500, "group_error", "删除分组失败")
		return
	}
	defer tx.Rollback(ctx)
	var used bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM groups WHERE parent_id=$1 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM users WHERE billing_group_id=$1 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM group_users WHERE group_id=$1 AND removed_at IS NULL) OR EXISTS(SELECT 1 FROM resource_access_grants WHERE group_id=$1)`, id).Scan(&used)
	if err != nil || used {
		writeError(w, 409, "group_in_use", "请先迁移子分组、成员计费归属、成员关系和资源授权")
		return
	}
	tag, err := tx.Exec(ctx, `UPDATE groups SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id)
	if err == nil && tag.RowsAffected() != 1 {
		err = errors.New("分组不存在")
	}
	u, _ := UserFromContext(ctx)
	if err == nil {
		err = groupAudit(ctx, tx, u, "delete_group", id, map[string]any{})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		writeError(w, 400, "group_error", "删除分组失败")
		return
	}
	w.WriteHeader(204)
}
func (s *Service) billingGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		GroupID *string `json:"group_id"`
	}
	if groupInput(w, r, &in) != nil {
		writeError(w, 400, "invalid_group", "计费归属无效")
		return
	}
	ctx := r.Context()
	tx, err := s.groupTx(r)
	if err != nil {
		writeError(w, 500, "group_error", "保存计费归属失败")
		return
	}
	defer tx.Rollback(ctx)
	if in.GroupID != nil {
		var id string
		if err = tx.QueryRow(ctx, `SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL`, *in.GroupID).Scan(&id); err != nil {
			writeError(w, 400, "invalid_group", "分组不存在")
			return
		}
	}
	id := chi.URLParam(r, "userID")
	var previous *string
	err = tx.QueryRow(ctx, `SELECT billing_group_id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&previous)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE users SET billing_group_id=$2,updated_at=now() WHERE id=$1`, id, in.GroupID)
	}
	u, _ := UserFromContext(ctx)
	if err == nil {
		err = groupAudit(ctx, tx, u, "assign_billing_group", id, map[string]any{"before": previous, "after": in.GroupID})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		writeError(w, 400, "group_error", "保存计费归属失败")
		return
	}
	w.WriteHeader(204)
}
func (s *Service) groupMembers(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UserIDs []string `json:"user_ids"`
	}
	if groupInput(w, r, &in) != nil || len(in.UserIDs) > 1000 {
		writeError(w, 400, "invalid_members", "成员列表无效")
		return
	}
	id := chi.URLParam(r, "groupID")
	if id == "00000000-0000-0000-0000-000000000001" || id == "00000000-0000-0000-0000-000000000002" {
		writeError(w, 409, "fixed_group", "系统分组成员按身份计算")
		return
	}
	ctx := r.Context()
	tx, err := s.groupTx(r)
	if err != nil {
		writeError(w, 500, "group_error", "保存成员失败")
		return
	}
	defer tx.Rollback(ctx)
	var found string
	if err = tx.QueryRow(ctx, `SELECT id FROM groups WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&found); err != nil {
		writeError(w, 404, "group_not_found", "分组不存在")
		return
	}
	_, err = tx.Exec(ctx, `UPDATE group_users SET removed_at=now() WHERE group_id=$1 AND removed_at IS NULL`, id)
	u, _ := UserFromContext(ctx)
	for _, user := range in.UserIDs {
		if err != nil {
			break
		}
		var active bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL)`, user).Scan(&active)
		if err == nil && !active {
			err = errors.New("用户不存在")
		}
		if err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)`, id, user, u.ID)
		}
	}
	if err == nil {
		err = groupAudit(ctx, tx, u, "assign_members", id, in)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		writeError(w, 400, "group_error", "保存成员失败，请检查重复或无效用户")
		return
	}
	w.WriteHeader(204)
}
