package billing

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgtype"
)

func entryUserID(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if id == "" {
		return "", nil
	}
	var value pgtype.UUID
	if err := value.Scan(id); err != nil || !value.Valid {
		return "", resource.Invalid("用户 ID 无效")
	}
	return id, nil
}

func (s *Service) searchEntryUsers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(query) > 200 {
		resource.Fail(r.Context(), w, resource.Invalid("搜索条件过长"))
		return
	}
	id, err := entryUserID(r.URL.Query().Get("id"))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	limit := 20
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 50 {
			resource.Fail(r.Context(), w, resource.Invalid("候选数量必须为 1 至 50"))
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	items, err := resource.DecodeObjects(sqlc.New(s.pool).SearchBillingUsers(ctx, sqlc.SearchBillingUsersParams{UserID: id, Query: query, ResultLimit: int32(limit + 1)}))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	hasNext := len(items) > limit
	if hasNext {
		items = items[:limit]
	}
	resource.JSON(r.Context(), w, 200, resource.Object{"items": items, "has_next": hasNext})
}
