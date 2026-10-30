package stats

import (
	"context"
	"encoding/json"
	"log/slog"
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
	params     sqlc.ListConversationsParams
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
	if value := strings.TrimSpace(q.Get("user_id")); value != "" {
		var id pgtype.UUID
		if err := id.Scan(value); err != nil || !id.Valid {
			return f, resource.Invalid("用户 ID 无效")
		}
		f.params.UserID = &value
	}
	f.params.TaskID = strings.TrimSpace(q.Get("task_id"))
	if f.params.TaskID != "" {
		var id pgtype.UUID
		if err := id.Scan(f.params.TaskID); err != nil || !id.Valid {
			if err != nil {
				slog.WarnContext(r.Context(), "操作失败", "module", "stats", "operation", "parseConversationFilter", "error", err)
			}
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
				slog.WarnContext(r.Context(), "操作失败", "module", "stats", "operation", "parseConversationFilter", "error", err)
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
				if err != nil {
					slog.WarnContext(r.Context(), "操作失败", "module", "stats", "operation", "parseConversationFilter", "error", err)
				}
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
		resource.Fail(r.Context(), w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	q := sqlc.New(s.pool)
	params := f.params
	params.Limit, params.Offset = int32(f.size+1), int32((f.page-1)*f.size)
	var rows [][]byte
	if params.TaskID == "" {
		rows, err = q.ListConversations(ctx, params)
	} else {
		rows, err = s.taskConversationRows(ctx, params)
	}
	items, err := resource.DecodeObjects(rows, err)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	hasNext := len(items) > f.size
	if hasNext {
		items = items[:f.size]
	}
	resource.JSON(r.Context(), w, http.StatusOK, resource.Object{
		"items": items, "has_next": hasNext, "page": f.page, "page_size": f.size,
	})
}

// Keep the indexed bounds and page in one snapshot. Taking the root lock before
// the first snapshot also prevents a concurrent cutover from changing which
// relation the second statement reads.
func (s *Service) taskConversationRows(ctx context.Context, params sqlc.ListConversationsParams) ([][]byte, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer rollbackStats(ctx, tx, "task_conversations")
	q := sqlc.New(tx)
	if err := q.LockConversationTurns(ctx); err != nil {
		return nil, err
	}
	task, err := taskConversationParams(ctx, q, params)
	if err != nil || task == nil {
		return nil, err
	}
	return q.ListTaskConversations(ctx, *task)
}

func taskConversationParams(ctx context.Context, q *sqlc.Queries, params sqlc.ListConversationsParams) (*sqlc.ListTaskConversationsParams, error) {
	raw, err := q.TaskTurnBounds(ctx, params.TaskID)
	if err != nil {
		return nil, err
	}
	var bounds struct {
		Backfilling bool       `json:"backfilling"`
		First       *time.Time `json:"first_at"`
		Last        *time.Time `json:"last_at"`
	}
	if err := json.Unmarshal(raw, &bounds); err != nil {
		return nil, err
	}
	if !bounds.Backfilling && bounds.First == nil {
		return nil, nil
	}
	return &sqlc.ListTaskConversationsParams{
		TaskID: params.TaskID, TitleQuery: params.TitleQuery, UserQuery: params.UserQuery, UserID: params.UserID, ContentQuery: params.ContentQuery,
		FromTime: params.FromTime, UntilTime: params.UntilTime, FirstTurnTime: bounds.First, LastTurnTime: bounds.Last,
		Limit: params.Limit, Offset: params.Offset,
	}, nil
}
