package stats

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type conversationFilter struct {
	params     sqlc.CountConversationsParams
	page, size int
}

func parseConversationFilter(r *http.Request) (conversationFilter, error) {
	q := r.URL.Query()
	f := conversationFilter{page: 1, size: 20}
	for _, field := range []struct {
		name   string
		target *string
	}{
		{"task", &f.params.TitleQuery},
		{"user", &f.params.UserQuery},
		{"content", &f.params.ContentQuery},
	} {
		*field.target = strings.TrimSpace(q.Get(field.name))
		if utf8.RuneCountInString(*field.target) > 200 {
			return f, resource.Invalid(field.name + " 搜索条件过长")
		}
	}
	f.params.TaskID = strings.TrimSpace(q.Get("task_id"))
	if f.params.TaskID != "" {
		var id pgtype.UUID
		if err := id.Scan(f.params.TaskID); err != nil || !id.Valid {
			return f, resource.Invalid("task_id 无效")
		}
	}
	for _, field := range []struct {
		name   string
		target **time.Time
	}{
		{"from", &f.params.FromTime},
		{"until", &f.params.UntilTime},
	} {
		if value := q.Get(field.name); value != "" {
			at, err := time.Parse(time.RFC3339, value)
			if err != nil {
				return f, resource.Invalid(field.name + " 需使用带时区的 RFC3339 时间")
			}
			*field.target = &at
		}
	}
	if f.params.FromTime != nil && f.params.UntilTime != nil && !f.params.FromTime.Before(*f.params.UntilTime) {
		return f, resource.Invalid("结束时间必须晚于开始时间")
	}
	for _, field := range []struct {
		name, message string
		target        *int
		maximum       int
	}{
		{"page", "page 必须为 1 至 1000000", &f.page, 1_000_000},
		{"page_size", "page_size 必须为 1 至 500", &f.size, 500},
	} {
		if value := q.Get(field.name); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > field.maximum {
				return f, resource.Invalid(field.message)
			}
			*field.target = n
		}
	}
	return f, nil
}

func (s *Service) conversations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	f, err := parseConversationFilter(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollbackStats(ctx, tx, "conversations")
	q := sqlc.New(tx)
	total, err := q.CountConversations(ctx, f.params)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	pages := max(1, (total+int64(f.size)-1)/int64(f.size))
	page := min(f.page, int(pages))
	items, err := resource.DecodeObjects(q.ListConversations(ctx, sqlc.ListConversationsParams{
		TaskID: f.params.TaskID, TitleQuery: f.params.TitleQuery,
		UserQuery: f.params.UserQuery, ContentQuery: f.params.ContentQuery,
		FromTime: f.params.FromTime, UntilTime: f.params.UntilTime,
		Limit: int32(f.size), Offset: int32((page - 1) * f.size),
	}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, resource.Object{
		"items": items, "total": total, "page": page, "page_size": f.size,
	})
}
