package endpoint

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// AdminReader keeps the administrator inventory separate from per-user device management.
type AdminReader interface {
	AdminDevices(context.Context, []byte, int, int) ([][]byte, error)
	AdminDeviceOverview(context.Context, []byte) ([]byte, error)
}

func (s *Service) RegisterAdmin(r chi.Router) {
	r.Get("/endpoints", s.adminDevices)
	r.Get("/endpoints/overview", s.adminOverview)
}

func deviceFilters(r *http.Request) ([]byte, error) {
	filters := map[string]string{}
	for _, field := range []struct {
		key   string
		limit int
	}{{"query", 200}, {"platform", 64}, {"client_type", 32}, {"client_version", 64}, {"arch", 32}, {"status", 16}, {"user_id", 36}} {
		value := strings.TrimSpace(r.URL.Query().Get(field.key))
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > field.limit {
			return nil, resource.Invalid("筛选条件过长")
		}
		filters[field.key] = value
	}
	if id := filters["user_id"]; id != "" {
		var value pgtype.UUID
		if err := value.Scan(id); err != nil || !value.Valid {
			return nil, resource.Invalid("用户 ID 无效")
		}
	}
	if status := filters["status"]; status != "" && status != "active" && status != "revoked" {
		return nil, resource.Invalid("设备状态无效")
	}
	var from, until time.Time
	for _, key := range []string{"from", "until"} {
		value := strings.TrimSpace(r.URL.Query().Get(key))
		if value == "" {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, value)
		if err != nil {
			return nil, resource.Invalid("时间需使用 RFC3339 格式")
		}
		filters[key] = at.UTC().Format(time.RFC3339Nano)
		if key == "from" {
			from = at
		} else {
			until = at
		}
	}
	if !from.IsZero() && !until.IsZero() && !from.Before(until) {
		return nil, resource.Invalid("结束时间必须晚于开始时间")
	}
	return json.Marshal(filters)
}

func devicePage(r *http.Request) (int, int, error) {
	page, size := 1, 50
	for _, entry := range []struct {
		key   string
		value *int
		max   int
	}{{"page", &page, 1000000}, {"page_size", &size, 500}} {
		if raw := r.URL.Query().Get(entry.key); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 1 || value > entry.max {
				return 0, 0, resource.Invalid("分页参数无效")
			}
			*entry.value = value
		}
	}
	return page, size, nil
}

func (s *Service) adminDevices(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	filters, err := deviceFilters(r)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	page, size, err := devicePage(r)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	reader, ok := s.store.(AdminReader)
	if !ok {
		resource.Fail(r.Context(), w, &resource.Error{Status: 503, Code: "service_unavailable", Message: "设备清单暂不可用"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	items, err := resource.DecodeObjects(reader.AdminDevices(ctx, filters, (page-1)*size, size+1))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	hasNext := len(items) > size
	if hasNext {
		items = items[:size]
	}
	resource.JSON(r.Context(), w, 200, resource.Object{"items": items, "page": page, "page_size": size, "has_next": hasNext})
}

func (s *Service) adminOverview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	for _, key := range []string{"page", "page_size", "cursor", "limit"} {
		if r.URL.Query().Has(key) {
			resource.Fail(r.Context(), w, resource.Invalid("设备概览不支持分页参数"))
			return
		}
	}
	filters, err := deviceFilters(r)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	reader, ok := s.store.(AdminReader)
	if !ok {
		resource.Fail(r.Context(), w, &resource.Error{Status: 503, Code: "service_unavailable", Message: "设备清单暂不可用"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	out, err := resource.DecodeObject(reader.AdminDeviceOverview(ctx, filters))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, 200, out)
}

func (p *Postgres) AdminDevices(ctx context.Context, filters []byte, offset, limit int) ([][]byte, error) {
	return sqlc.New(p.pool).AdminDevices(ctx, sqlc.AdminDevicesParams{Filters: filters, PageOffset: int32(offset), PageLimit: int32(limit)})
}
func (p *Postgres) AdminDeviceOverview(ctx context.Context, filters []byte) ([]byte, error) {
	return sqlc.New(p.pool).AdminDeviceOverview(ctx, filters)
}
