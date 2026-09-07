package identity

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

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
