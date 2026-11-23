package identity

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) userCandidates(w http.ResponseWriter, r *http.Request, q url.Values) {
	w.Header().Set("Cache-Control", "private, no-store")
	badRequest := func(message string) { writeError(r.Context(), w, http.StatusBadRequest, "invalid_input", message) }
	includeDeleted := false
	if q.Has("include_deleted") {
		switch q.Get("include_deleted") {
		case "true":
			actor, ok := UserFromContext(r.Context())
			if !ok || actor.Role != "admin" {
				writeError(r.Context(), w, http.StatusForbidden, "forbidden", "需要管理员权限")
				return
			}
			includeDeleted = true
		case "false":
		default:
			badRequest("include_deleted 必须为 true 或 false")
			return
		}
	}
	term := strings.TrimSpace(q.Get("q"))
	if utf8.RuneCountInString(term) > 200 {
		badRequest("搜索条件过长")
		return
	}
	id := strings.TrimSpace(q.Get("id"))
	if id != "" {
		var parsed pgtype.UUID
		if err := parsed.Scan(id); err != nil {
			badRequest("用户 ID 无效")
			return
		}
		id = parsed.String()
	}
	limit := 20
	if raw := q.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 50 {
			badRequest("候选数量必须为 1 至 50")
			return
		}
		limit = n
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := sqlc.New(s.db).SearchAdminUserCandidates(ctx, sqlc.SearchAdminUserCandidatesParams{IncludeDeleted: includeDeleted, UserID: id, Query: term, ResultLimit: int32(limit + 1)})
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "搜索用户失败", "module", "identity", "operation", "userCandidates", "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "读取用户失败")
		return
	}
	hasNext := len(rows) > limit
	if hasNext {
		rows = rows[:limit]
	}
	items := make([]json.RawMessage, len(rows))
	for i, row := range rows {
		items[i] = row
	}
	writeJSON(r.Context(), w, http.StatusOK, map[string]any{"items": items, "has_next": hasNext})
}
