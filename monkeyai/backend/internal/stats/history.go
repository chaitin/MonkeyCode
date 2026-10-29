package stats

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
)

func (s *Service) history(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	title, user := strings.TrimSpace(q.Get("task")), strings.TrimSpace(q.Get("user"))
	if len(title) > 200 || len(user) > 200 {
		resource.Fail(r.Context(), w, resource.Invalid("搜索条件过长"))
		return
	}
	var from, until *time.Time
	for key, target := range map[string]**time.Time{"from": &from, "until": &until} {
		if value := q.Get(key); value != "" {
			at, err := time.Parse(time.RFC3339, value)
			if err != nil {
				slog.WarnContext(r.Context(), "操作失败", "module", "stats", "operation", "history", "error", err)
				resource.Fail(r.Context(), w, resource.Invalid("筛选时间需使用带时区的 ISO 格式"))
				return
			}
			*target = &at
		}
	}
	if from != nil && until != nil && !from.Before(*until) {
		resource.Fail(r.Context(), w, resource.Invalid("结束时间必须晚于开始时间"))
		return
	}
	page, size := 1, 20
	for key, target := range map[string]*int{"page": &page, "page_size": &size} {
		if value := q.Get(key); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 1_000_000 || (key == "page_size" && n > 500) {
				if err != nil {
					slog.WarnContext(r.Context(), "操作失败", "module", "stats", "operation", "history", "error", err)
				}
				resource.Fail(r.Context(), w, resource.Invalid("分页参数无效"))
				return
			}
			*target = n
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	items, err := resource.DecodeObjects(sqlc.New(s.pool).ListHistory(ctx, sqlc.ListHistoryParams{
		TitleQuery: title,
		UserQuery:  user,
		FromTime:   from,
		UntilTime:  until,
		Limit:      int32(size + 1),
		Offset:     int32((page - 1) * size),
	}))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	hasNext := len(items) > size
	if hasNext {
		items = items[:size]
	}
	resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"items": items, "has_next": hasNext, "page": page, "page_size": size})
}
