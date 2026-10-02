package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/sessions", s.listSessions)
	router.Get("/sessions/{id}", s.sessionDetail)
	router.Delete("/sessions/{id}", s.clearSession)
}

type sessionListFilter struct {
	clauses []string
	args    []any
	params  sqlc.CountSessionsParams
}

func (f *sessionListFilter) argument(value any) string {
	f.args = append(f.args, value)
	return "$" + strconv.Itoa(len(f.args))
}

func (f *sessionListFilter) add(format string, value any) {
	f.clauses = append(f.clauses, fmt.Sprintf(format, f.argument(value)))
}

func (f *sessionListFilter) where() string {
	if len(f.clauses) == 0 {
		return "TRUE"
	}
	return strings.Join(f.clauses, " AND ")
}

func (s *Service) listSessions(w http.ResponseWriter, r *http.Request) {
	page, size, err := resource.PageParams(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	filter, err := sessionFilters(r)
	if err == nil && !s.canPurge(r.Context()) && (r.URL.Query().Get("include_purged") == "true" || r.URL.Query().Get("status") == "purged" || r.URL.Query().Get("status") == "all") {
		err = &resource.Error{Status: http.StatusForbidden, Code: "forbidden", Message: "没有查看清除记录的权限"}
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	p := filter.params
	q := sqlc.New(s.pool)
	data, err := q.ListSessions(r.Context(), sqlc.ListSessionsParams{
		Status: p.Status, OwnerID: p.OwnerID, GroupID: p.GroupID, ParentID: p.ParentID,
		SessionType: p.SessionType, ClientType: p.ClientType, FromTime: p.FromTime,
		UntilTime: p.UntilTime, IncludeDeleted: p.IncludeDeleted,
		IncludePurged: p.IncludePurged, IncludePlaceholder: p.IncludePlaceholder,
		IncludeLegacy: p.IncludeLegacy, PageLimit: int32(size), PageOffset: int32((page - 1) * size),
	})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	items := make([]resource.Object, 0, len(data))
	for _, raw := range data {
		var item resource.Object
		if err := json.Unmarshal(raw, &item); err != nil {
			resource.Fail(w, err)
			return
		}
		items = append(items, item)
	}
	total, err := q.CountSessions(r.Context(), p)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, resource.Object{
		"items": items, "total": total, "page": page, "page_size": size, "pagination": "page",
	})
}

func sessionFilters(r *http.Request) (sessionListFilter, error) {
	var filter sessionListFilter
	q := r.URL.Query()
	if q.Get("cursor") != "" || q.Has("cursor") {
		return filter, resource.Invalid("当前会话列表仅支持 page 分页，不支持 cursor")
	}

	ownerID := firstQuery(q.Get("owner_user_id"), q.Get("owner_id"), q.Get("user_id"))
	if ownerID != "" {
		if !validUUID(ownerID) {
			return filter, resource.Invalid("owner_user_id 无效")
		}
		filter.add("owner_user_id = %s::uuid", ownerID)
	}
	if groupID := q.Get("group_id"); groupID != "" {
		if !validUUID(groupID) {
			return filter, resource.Invalid("group_id 无效")
		}
		filter.add("group_id = %s::uuid", groupID)
	}
	if parentID := q.Get("parent_session_id"); parentID != "" {
		if !validUUID(parentID) {
			return filter, resource.Invalid("parent_session_id 无效")
		}
		filter.add("parent_session_id = %s::uuid", parentID)
	}
	if value := q.Get("session_type"); value != "" {
		if !contains([]string{"conversation", "workflow", "tool", "scheduled"}, value) {
			return filter, resource.Invalid("session_type 无效")
		}
		filter.add("session_type = %s", value)
	}
	if value := q.Get("client_type"); value != "" {
		if !contains([]string{"desktop", "web", "extension", "mobile", "unknown"}, value) {
			return filter, resource.Invalid("client_type 无效")
		}
		filter.add("client_type = %s", value)
	}
	from, err := queryTime(q, "from", "since")
	if err != nil {
		return filter, err
	}
	until, err := queryTime(q, "until", "to")
	if err != nil {
		return filter, err
	}
	if from != nil && until != nil && !from.Before(*until) {
		return filter, resource.Invalid("时间范围无效")
	}
	if from != nil {
		filter.add("started_at >= %s", *from)
	}
	if until != nil {
		filter.add("started_at < %s", *until)
	}

	status := q.Get("status")
	if status != "" {
		switch status {
		case "all":
		case "deleted":
			filter.clauses = append(filter.clauses, "deleted_at IS NOT NULL")
		case "purged":
			filter.clauses = append(filter.clauses, "purged_at IS NOT NULL")
		case "placeholder":
			filter.clauses = append(filter.clauses, "placeholder = true AND purged_at IS NULL")
		case "legacy", "old_reporting":
			filter.clauses = append(filter.clauses, "reporting_enabled_at IS NULL AND purged_at IS NULL")
		case "reporting":
			filter.clauses = append(filter.clauses, "reporting_enabled_at IS NOT NULL AND purged_at IS NULL")
		default:
			return filter, resource.Invalid("status 无效")
		}
	} else {
		includeDeleted, err := queryBool(q.Get("include_deleted"))
		if err != nil {
			return filter, resource.Invalid("include_deleted 无效")
		}
		includePurged, err := queryBool(q.Get("include_purged"))
		if err != nil {
			return filter, resource.Invalid("include_purged 无效")
		}
		includePlaceholder, err := queryBool(q.Get("include_placeholder"))
		if err != nil {
			return filter, resource.Invalid("include_placeholder 无效")
		}
		includeLegacy, err := queryBool(firstQuery(q.Get("include_legacy"), q.Get("include_old_reporting")))
		if err != nil {
			return filter, resource.Invalid("include_legacy 无效")
		}
		if !includeDeleted {
			filter.clauses = append(filter.clauses, "deleted_at IS NULL")
		}
		if !includePurged {
			filter.clauses = append(filter.clauses, "purged_at IS NULL")
		}
		if !includePlaceholder {
			filter.clauses = append(filter.clauses, "placeholder = false")
		}
		if !includeLegacy {
			filter.clauses = append(filter.clauses, "reporting_enabled_at IS NOT NULL")
		}
	}
	filter.params = sqlc.CountSessionsParams{
		Status: status, OwnerID: ownerID, GroupID: q.Get("group_id"),
		ParentID: q.Get("parent_session_id"), SessionType: q.Get("session_type"),
		ClientType: q.Get("client_type"),
	}
	if from != nil {
		filter.params.FromTime = from.Format(time.RFC3339Nano)
	}
	if until != nil {
		filter.params.UntilTime = until.Format(time.RFC3339Nano)
	}
	filter.params.IncludeDeleted, _ = queryBool(q.Get("include_deleted"))
	filter.params.IncludePurged, _ = queryBool(q.Get("include_purged"))
	filter.params.IncludePlaceholder, _ = queryBool(q.Get("include_placeholder"))
	filter.params.IncludeLegacy, _ = queryBool(firstQuery(q.Get("include_legacy"), q.Get("include_old_reporting")))
	return filter, nil
}

func queryBool(value string) (bool, error) {
	if value == "" {
		return false, nil
	}
	return strconv.ParseBool(value)
}

func queryTime(q map[string][]string, primary, fallback string) (*time.Time, error) {
	value := ""
	if values := q[primary]; len(values) > 0 {
		value = values[0]
	} else if values := q[fallback]; len(values) > 0 {
		value = values[0]
	}
	if value == "" {
		return nil, nil
	}
	at, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, resource.Invalid(primary + " 无效")
	}
	return &at, nil
}

func firstQuery(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
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
		"session_type": row.SessionType, "client_type": row.ClientType, "client_name": row.ClientName,
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
	confirm := firstQuery(strings.TrimSpace(r.Header.Get("X-Confirm-Session-ID")), strings.TrimSpace(r.URL.Query().Get("confirm_session_id")))
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
	rootID := id
	if row.ParentSessionID != nil {
		rootID = *row.ParentSessionID
	}
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
