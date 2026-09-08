package stats

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

const historyFilter = ` FROM sessions s JOIN users u ON u.id=s.owner_user_id WHERE s.deleted_at IS NULL
 AND ($1='' OR strpos(lower(s.title),lower($1))>0 OR strpos(s.id::text,lower($1))>0)
 AND ($2='' OR strpos(lower(u.name),lower($2))>0 OR strpos(lower(u.email),lower($2))>0)
 AND ($3::timestamptz IS NULL OR s.started_at >= $3) AND ($4::timestamptz IS NULL OR s.started_at < $4)`

func (s *Service) history(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	title, user := strings.TrimSpace(q.Get("task")), strings.TrimSpace(q.Get("user"))
	if len(title) > 200 || len(user) > 200 {
		resource.Fail(w, resource.Invalid("搜索条件过长"))
		return
	}
	var from, until *time.Time
	for key, target := range map[string]**time.Time{"from": &from, "until": &until} {
		if value := q.Get(key); value != "" {
			at, err := time.Parse(time.RFC3339, value)
			if err != nil {
				resource.Fail(w, resource.Invalid("筛选时间需使用带时区的 ISO 格式"))
				return
			}
			*target = &at
		}
	}
	if from != nil && until != nil && !from.Before(*until) {
		resource.Fail(w, resource.Invalid("结束时间必须晚于开始时间"))
		return
	}
	page, size := 1, 20
	for key, target := range map[string]*int{"page": &page, "page_size": &size} {
		if value := q.Get(key); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || n > 1_000_000 || (key == "page_size" && n > 500) {
				resource.Fail(w, resource.Invalid("分页参数无效"))
				return
			}
			*target = n
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	args := []any{title, user, from, until}
	var total int64
	if err = tx.QueryRow(ctx, `SELECT count(*)`+historyFilter, args...).Scan(&total); err != nil {
		resource.Fail(w, err)
		return
	}
	pages := max(1, (total+int64(size)-1)/int64(size))
	page = min(page, int(pages))
	items, err := resource.Rows(ctx, tx, `SELECT jsonb_build_object('id',s.id,'title',s.title,'user_name',u.name,'user_email',u.email,
 'started_at',s.started_at,'last_active_at',s.last_active_at,'turn_count',s.turn_count)`+historyFilter+` ORDER BY s.started_at DESC,s.id DESC LIMIT $5 OFFSET $6`, append(args, size, (page-1)*size)...)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	resource.JSON(w, http.StatusOK, resource.Object{"items": items, "total": total, "page": page, "page_size": size})
}
