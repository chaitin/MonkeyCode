package environment

import (
	"net/http"
	"net/url"
)

type listFilter struct {
	status, sort string
	hostID       *string
}

func listFilters(r *http.Request) (listFilter, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q["status"]) > 1 || len(q["sort"]) > 1 || len(q["host_id"]) > 1 {
		return listFilter{}, bad("环境筛选参数格式无效")
	}
	filter := listFilter{status: q.Get("status"), sort: q.Get("sort")}
	if q.Has("host_id") {
		host := q.Get("host_id")
		if !uuid.MatchString(host) {
			return listFilter{}, bad("宿主筛选无效")
		}
		filter.hostID = &host
	}
	if filter.status == "" {
		filter.status = "active"
	}
	if filter.sort == "" {
		filter.sort = "newest"
	}
	switch filter.status {
	case "active", "all", "running", "stopped", "failed", "deleted", "pending_running", "pending_stopped", "pending_deleted":
	default:
		return listFilter{}, bad("环境状态筛选无效")
	}
	switch filter.sort {
	case "newest", "cpu_desc", "cpu_asc", "memory_desc", "memory_asc":
	default:
		return listFilter{}, bad("环境排序方式无效")
	}
	return filter, nil
}
