package identity

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"

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
	if _, err = sqlc.New(tx).LockGroups(r.Context()); err != nil {
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
	return audit.Write(ctx, tx, audit.Event{ActorID: user.ID, Action: action, Category: "identity", TargetType: "user", TargetID: id, Params: data})
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
		if _, err = sqlc.New(tx).GetGroup(ctx, *in.GroupID); err != nil {
			writeError(w, 400, "invalid_group", "分组不存在")
			return
		}
	}
	id := chi.URLParam(r, "userID")
	var previous *string
	previous, err = sqlc.New(tx).LockBillingGroup(ctx, id)

	if err == nil {
		_, err = sqlc.New(tx).SetBillingGroup(ctx, sqlc.SetBillingGroupParams{ID: id, BillingGroupID: in.GroupID})
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
