package environment

import (
	"net/http"
	"net/url"
)

func listFilters(r *http.Request) (string, string, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q["status"]) > 1 || len(q["sort"]) > 1 {
		return "", "", bad("环境筛选参数格式无效")
	}
	status, sort := q.Get("status"), q.Get("sort")
	if status == "" {
		status = "active"
	}
	if sort == "" {
		sort = "newest"
	}
	switch status {
	case "active", "all", "running", "stopped", "failed", "deleted", "pending_running", "pending_stopped", "pending_deleted":
	default:
		return "", "", bad("环境状态筛选无效")
	}
	switch sort {
	case "newest", "cpu_desc", "cpu_asc", "memory_desc", "memory_asc":
	default:
		return "", "", bad("环境排序方式无效")
	}
	return status, sort, nil
}
