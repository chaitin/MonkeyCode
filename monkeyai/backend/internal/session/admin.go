package session

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/sessions/{id}", s.sessionDetail)
	router.Delete("/sessions/{id}", s.clearSession)
}

func (s *Service) sessionDetail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !validUUID(id) {
		resource.Fail(w, invalidSession("会话 ID 无效"))
		return
	}
	row, err := readSession(r.Context(), s.pool, id, false)
	if errors.Is(err, pgx.ErrNoRows) {
		resource.Fail(w, resource.NotFound)
		return
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if row.PurgedAt != nil {
		resource.Fail(w, sessionFailure(http.StatusGone, "session_purged", "会话统计数据已清除"))
		return
	}
	stats, err := s.sessionStats(r.Context(), id)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, resource.Object{
		"id": row.ID, "owner_user_id": row.OwnerUserID, "group_id": row.GroupID,
		"parent_session_id": row.ParentSessionID, "model_id": row.ModelID, "device_id": row.DeviceID,
		"title": row.Title, "title_source": row.TitleSource, "session_type": row.SessionType, "client_type": row.ClientType, "client_name": row.ClientName,
		"mode": row.Mode, "workspace_kind": row.WorkspaceKind, "client_version": row.ClientVersion,
		"engine_version": row.EngineVersion, "runtime_version": row.RuntimeVersion,
		"placeholder": row.Placeholder, "state_seq": row.StateSeq, "acked_turn": row.AckedTurn,
		"started_at": row.StartedAt, "last_active_at": row.LastActiveAt, "ended_at": row.EndedAt,
		"reporting_enabled_at": row.ReportingEnabled, "deleted_at": row.DeletedAt, "purged_at": row.PurgedAt,
		"tombstone": false, "stats": stats,
	})
}

func (s *Service) sessionStats(ctx context.Context, id string) (resource.Object, error) {
	data, err := sqlc.New(s.pool).SessionStats(ctx, id)
	if err != nil {
		return nil, err
	}
	var stats resource.Object
	if err := json.Unmarshal(data, &stats); err != nil {
		return nil, err
	}
	return stats, nil
}

func (s *Service) clearSession(w http.ResponseWriter, r *http.Request) {
	if !s.canPurge(r.Context()) {
		resource.Fail(w, &resource.Error{Status: http.StatusForbidden, Code: "forbidden", Message: "没有清除会话的权限"})
		return
	}
	operator, err := agentUser(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	id := chi.URLParam(r, "id")
	if !validUUID(id) {
		resource.Fail(w, invalidSession("会话 ID 无效"))
		return
	}
	confirm := strings.TrimSpace(r.Header.Get("X-Confirm-Session-ID"))
	if confirm != id {
		resource.Fail(w, invalidSession("必须确认要清除的会话 ID"))
		return
	}
	tx, err := s.begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollback(r.Context(), tx)
	row, err := readSession(r.Context(), tx, id, false)
	if errors.Is(err, pgx.ErrNoRows) {
		resource.Fail(w, resource.NotFound)
		return
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if row.ParentSessionID != nil {
		resource.Fail(w, invalidSession("只能从顶层会话清除统计数据"))
		return
	}
	rootID := id
	q := sqlc.New(tx)
	ids, err := q.LockFamily(r.Context(), rootID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if len(ids) == 0 {
		resource.Fail(w, resource.NotFound)
		return
	}
	for _, erase := range []func(context.Context, []string) error{
		q.DeleteModelCalls, q.DeleteMCPCalls, q.DeleteImageCalls,
		q.DeleteTurnTools, q.DeleteSkillEvents, q.DeleteTurns,
		q.DeleteSnapshotItems, q.DeleteSnapshots, q.PurgeSessions,
	} {
		if err := erase(r.Context(), ids); err != nil {
			resource.Fail(w, err)
			return
		}
	}
	if err := audit.Write(r.Context(), tx, audit.Event{ActorID: operator.ID, Action: "session.purge", Category: "security", TargetType: "session", TargetID: rootID, Params: map[string]any{"confirmed_session_id": id, "session_count": len(ids)}}); err != nil {
		resource.Fail(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		resource.Fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
