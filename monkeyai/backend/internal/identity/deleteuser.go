package identity

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) deleteUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	actor, ok := UserFromContext(ctx)
	if !ok || actor.Role != "admin" {
		writeError(ctx, w, http.StatusForbidden, "forbidden", "需要管理员权限")
		return
	}
	var id pgtype.UUID
	if id.Scan(chi.URLParam(r, "userID")) != nil || !id.Valid {
		writeError(ctx, w, http.StatusBadRequest, "invalid_request", "成员 ID 无效")
		return
	}
	userID := id.String()
	if userID == actor.ID {
		writeError(ctx, w, http.StatusConflict, "cannot_delete_self", "不能删除自己的账号")
		return
	}
	switch err := s.removeUser(ctx, actor.ID, userID); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, ErrAdminRoleRequired):
		writeError(ctx, w, http.StatusForbidden, "forbidden", "需要管理员权限")
	case errors.Is(err, pgx.ErrNoRows):
		writeError(ctx, w, http.StatusNotFound, "user_not_found", "用户不存在")
	default:
		logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "删除用户失败", "module", "identity", "operation", "deleteUser", "user_id", userID, "error", err)
		writeError(ctx, w, http.StatusInternalServerError, "server_error", "删除用户失败")
	}
}

func (s *Service) removeUser(ctx context.Context, actorID, userID string) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		q := sqlc.New(tx)
		if err := q.LockUserCreationGroups(ctx); err != nil {
			return err
		}
		// 等待分组写锁之后重新校验操作者，避免两个管理员同时互删。
		if _, err := q.LockActiveAdmin(ctx, actorID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrAdminRoleRequired
			}
			return err
		}
		if _, err := q.GetUser(ctx, userID); err != nil {
			return err
		}
		if s.accounts != nil {
			if err := s.accounts.PreserveAccounts(ctx, tx); err != nil {
				return err
			}
		}
		email, err := q.MarkUserDeleted(ctx, userID)
		if err != nil {
			return err
		}
		if err := q.MarkUserIdentitiesDeleted(ctx, userID); err != nil {
			return err
		}
		if err := q.RemoveDeletedUserGroups(ctx, userID); err != nil {
			return err
		}
		if err := revokePasswordAccess(ctx, q, userID, email); err != nil {
			return err
		}
		return q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: email, Purpose: "reset"})
	})
}
