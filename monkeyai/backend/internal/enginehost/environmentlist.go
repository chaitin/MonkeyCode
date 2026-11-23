package enginehost

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/memberscope"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) RegisterEnvironmentList(get memberscope.Get) {
	get("/environments", s.environmentList)
}

func environmentListParams(r *http.Request) (sqlc.ListMemberEnvironmentsParams, int, int, error) {
	q := r.URL.Query()
	p := sqlc.ListMemberEnvironmentsParams{StateFilter: q.Get("status"), Ordering: q.Get("sort"), UserQuery: strings.TrimSpace(q.Get("user")), NameQuery: strings.TrimSpace(q.Get("name"))}
	for _, key := range []string{"status", "sort", "name", "user", "page", "page_size", "host_id", "user_id"} {
		if q.Has(key) && (len(q[key]) != 1 || (q.Get(key) == "" && key != "name" && key != "user")) {
			return p, 0, 0, resource.Invalid(key + " 无效")
		}
	}
	if p.StateFilter == "" {
		p.StateFilter = "active"
	}
	if p.Ordering == "" {
		p.Ordering = "newest"
	}
	if !slices.Contains([]string{"active", "all", "running", "stopped", "failed", "pending_running", "pending_stopped", "pending_deleted", "deleted"}, p.StateFilter) || !slices.Contains([]string{"newest", "cpu_desc", "cpu_asc", "memory_desc", "memory_asc"}, p.Ordering) {
		return p, 0, 0, resource.Invalid("状态或排序无效")
	}
	if utf8.RuneCountInString(p.NameQuery) > 200 || utf8.RuneCountInString(p.UserQuery) > 200 {
		return p, 0, 0, resource.Invalid("搜索条件过长")
	}
	for key, dst := range map[string]**string{"host_id": &p.HostID, "user_id": &p.UserID} {
		if v := q.Get(key); v != "" {
			var id pgtype.UUID
			if err := id.Scan(v); err != nil || !id.Valid {
				return p, 0, 0, resource.Invalid(key + " 无效")
			}
			*dst = &v
		}
	}
	page, size, err := resource.PageParamsWithLimit(r, 100)
	p.PageLimit = int32(size)
	p.PageOffset = int32((page - 1) * size)
	return p, page, size, err
}

func (s *Service) environmentList(w http.ResponseWriter, r *http.Request, scope memberscope.Scope) {
	w.Header().Set("Cache-Control", "private, no-store")
	p, page, size, err := environmentListParams(r)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	p.VisibleUsers = scope.IDs()
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	items, err := resource.DecodeObjects(sqlc.New(s.pool).ListMemberEnvironments(ctx, p))
	if err != nil {
		resource.Fail(ctx, w, err)
		return
	}
	resource.JSON(ctx, w, 200, resource.Object{"items": items, "page": page, "page_size": size})
}
