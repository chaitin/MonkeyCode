package environment

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func respond(w http.ResponseWriter, r *http.Request, status int, v any) {
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, status, v)
}
func fail(w http.ResponseWriter, r *http.Request, err error) {
	w.Header().Set("Cache-Control", "no-store")
	if errors.Is(err, pgx.ErrNoRows) {
		err = notFound
	}
	var e *failure
	if errors.As(err, &e) {
		respond(w, r, e.status, map[string]any{"error": map[string]string{"code": e.code, "message": web.Message(r.Context(), e.code, e.message)}})
		return
	}
	resource.Fail(r.Context(), w, err)
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
		fail(w, r, bad("请求字段或格式无效"))
		return false
	}
	return true
}
func (s *Service) RegisterAgent(r chi.Router) {
	r.With(identity.RequireScope("environment:read")).Get("/environments", s.list(false))
	r.With(identity.RequireScope("environment:read")).Get("/environments/{id}", s.get(false))
	r.With(identity.RequireScope("environment:read")).Get("/environments/{id}/operations", s.operations(false))
	r.With(identity.RequireScope("environment:manage")).Post("/environments", s.create)
	r.With(identity.RequireScope("environment:manage")).Post("/environments/{id}/start", s.change(false, "running"))
	r.With(identity.RequireScope("environment:manage")).Post("/environments/{id}/stop", s.change(false, "stopped"))
	r.With(identity.RequireScope("environment:manage")).Delete("/environments/{id}", s.change(false, "deleted"))
}
func (s *Service) RegisterAdmin(r chi.Router) {
	r.Get("/environment-presets", s.presets(true))
	r.Post("/environment-presets", s.createPreset)
	r.Patch("/environment-presets/{id}", s.enablePreset)
	r.Get("/environment-hosts", s.hosts)
	r.Put("/environment-hosts/{id}", s.setHost)
	r.Patch("/environment-hosts/{id}/scheduling", s.setScheduling)
	r.Get("/environment-hosts/{id}/setup", s.getSetup)
	r.Put("/environment-hosts/{id}/setup", s.putSetup)
	r.Get("/environment-quotas/{id}", s.getQuota)
	r.Put("/environment-quotas/{id}", s.setQuota)
	r.Get("/environments", s.list(true))
	r.Get("/environments/{id}", s.get(true))
	r.Get("/environments/{id}/operations", s.operations(true))
	r.Post("/environments/{id}/stop", s.change(true, "stopped"))
	r.Delete("/environments/{id}", s.change(true, "deleted"))
}
func owner(r *http.Request, admin bool) *string {
	if admin {
		return nil
	}
	user, ok := identity.UserFromContext(r.Context())
	if !ok {
		return new(string)
	}
	return &user.ID
}
func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	if s.runtime == nil {
		fail(w, r, &failure{503, "runtime_unavailable", "云环境需要启用远程执行中转"})
		return
	}
	var in Creation
	if !decode(w, r, &in) {
		return
	}
	user := owner(r, false)
	out, err := s.Create(r.Context(), *user, in)
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 202, out)
}
func (s *Service) change(admin bool, desired string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in Change
		if !decode(w, r, &in) {
			return
		}
		out, err := s.Change(r.Context(), owner(r, admin), chi.URLParam(r, "id"), desired, in)
		if err != nil {
			fail(w, r, err)
			return
		}
		respond(w, r, 202, out)
	}
}
func (s *Service) list(admin bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, size, err := resource.PageParamsWithLimit(r, 100)
		if err != nil {
			fail(w, r, err)
			return
		}
		status, sort := "all", "newest"
		if admin {
			status, sort, err = listFilters(r)
			if err != nil {
				fail(w, r, err)
				return
			}
		}
		rows, err := sqlc.New(s.pool).ListEnvironments(r.Context(), sqlc.ListEnvironmentsParams{UserID: owner(r, admin), Limit: int32(size), Offset: int32((page - 1) * size), Status: status, Sort: sort})
		if err != nil {
			fail(w, r, err)
			return
		}
		items := make([]View, 0, len(rows))
		for _, row := range rows {
			item, err := s.environmentView(r.Context(), row)
			if err != nil {
				fail(w, r, err)
				return
			}
			items = append(items, item)
		}
		if admin {
			if err := s.identities(r.Context(), items); err != nil {
				fail(w, r, err)
				return
			}
		}
		respond(w, r, 200, map[string]any{"items": items, "page": page, "page_size": size})
	}
}
func (s *Service) get(admin bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if !uuid.MatchString(id) {
			fail(w, r, notFound)
			return
		}
		env, err := sqlc.New(s.pool).GetEnvironment(r.Context(), sqlc.GetEnvironmentParams{ID: id, UserID: owner(r, admin)})
		if err != nil {
			fail(w, r, err)
			return
		}
		out, err := s.environmentView(r.Context(), env)
		if err != nil {
			fail(w, r, err)
			return
		}
		if admin {
			items := []View{out}
			if err := s.identities(r.Context(), items); err != nil {
				fail(w, r, err)
				return
			}
			out = items[0]
		}
		respond(w, r, 200, out)
	}
}
func (s *Service) operations(admin bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if !uuid.MatchString(id) {
			fail(w, r, notFound)
			return
		}
		q := sqlc.New(s.pool)
		if _, err := q.GetEnvironment(r.Context(), sqlc.GetEnvironmentParams{ID: id, UserID: owner(r, admin)}); err != nil {
			fail(w, r, err)
			return
		}
		page, size, err := resource.PageParamsWithLimit(r, 100)
		if err != nil {
			fail(w, r, err)
			return
		}
		rows, err := q.ListOperations(r.Context(), sqlc.ListOperationsParams{EnvironmentID: id, Limit: int32(size), Offset: int32((page - 1) * size)})
		if err != nil {
			fail(w, r, err)
			return
		}
		items := make([]Operation, 0, len(rows))
		for _, row := range rows {
			items = append(items, operation(row))
		}
		respond(w, r, 200, map[string]any{"items": items, "page": page, "page_size": size})
	}
}
func (s *Service) presets(admin bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, size, err := resource.PageParamsWithLimit(r, 100)
		if err != nil {
			fail(w, r, err)
			return
		}
		rows, err := sqlc.New(s.pool).ListPresets(r.Context(), sqlc.ListPresetsParams{IncludeDisabled: admin, Limit: int32(size), Offset: int32((page - 1) * size)})
		if err != nil {
			fail(w, r, err)
			return
		}
		items := make([]any, 0, len(rows))
		for _, row := range rows {
			items = append(items, presetView(row))
		}
		respond(w, r, 200, map[string]any{"items": items, "page": page, "page_size": size})
	}
}
func (s *Service) createPreset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name          string  `json:"name"`
		Configuration Profile `json:"configuration"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !validName(in.Name) {
		fail(w, r, bad("预设名称无效"))
		return
	}
	if err := in.Configuration.Validate(); err != nil {
		fail(w, r, bad(err.Error()))
		return
	}
	p := in.Configuration
	p.Storage = Storage{}
	raw, _ := json.Marshal(p)
	row, err := sqlc.New(s.pool).CreatePreset(r.Context(), sqlc.CreatePresetParams{Name: in.Name, Architecture: p.Architecture, Configuration: raw, CpuMillis: p.Resource.CPUMillis, MemoryBytes: p.Resource.MemoryBytes, StorageBytes: 0})
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 201, presetView(row))
}
func (s *Service) enablePreset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if !decode(w, r, &in) {
		return
	}
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) || in.Enabled == nil {
		fail(w, r, bad("预设参数无效"))
		return
	}
	err := s.transaction(r.Context(), func(q *sqlc.Queries) error {
		n, err := q.EnablePreset(r.Context(), sqlc.EnablePresetParams{ID: id, Enabled: *in.Enabled})
		if err != nil {
			return err
		}
		if n != 1 {
			return notFound
		}
		return nil
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(204)
}

type Capacity struct {
	Enabled         bool  `json:"enabled"`
	CPUMillis       int64 `json:"cpu_millis"`
	MemoryBytes     int64 `json:"memory_bytes"`
	StorageBytes    int64 `json:"storage_bytes"`
	MaxEnvironments int32 `json:"max_environments"`
}

func (s *Service) hosts(w http.ResponseWriter, r *http.Request) {
	page, size, err := resource.PageParamsWithLimit(r, 100)
	if err != nil {
		fail(w, r, err)
		return
	}
	rows, err := sqlc.New(s.pool).ListHosts(r.Context(), sqlc.ListHostsParams{Limit: int32(size), Offset: int32((page - 1) * size)})
	if err != nil {
		fail(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		capacity := reportedCapacity(row.Report)
		items = append(items, map[string]any{"host_id": row.HostID, "enabled": row.Enabled, "cpu_millis": capacity.CPUMillis, "memory_bytes": capacity.MemoryBytes, "storage_bytes": int64(0), "max_environments": 0, "architecture": row.Architecture, "status": row.Status, "last_seen_at": row.LastSeenAt, "protocol": row.Protocol, "sync_at": row.SyncAt})
	}
	respond(w, r, 200, map[string]any{"items": items, "page": page, "page_size": size})
}
func (s *Service) setHost(w http.ResponseWriter, r *http.Request) {
	var in Capacity
	if !decode(w, r, &in) {
		return
	}
	s.saveScheduling(w, r, in.Enabled)
}
func (s *Service) setScheduling(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled *bool `json:"enabled"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Enabled == nil {
		fail(w, r, bad("必须指定是否允许分配新环境"))
		return
	}
	s.saveScheduling(w, r, *in.Enabled)
}
func (s *Service) saveScheduling(w http.ResponseWriter, r *http.Request, enabled bool) {
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		fail(w, r, notFound)
		return
	}
	var out Capacity
	err := s.transaction(r.Context(), func(q *sqlc.Queries) error {
		host, err := q.HostStatus(r.Context(), id)
		if err != nil {
			return err
		}
		if host.Status != "active" {
			return conflict("host_unavailable", "宿主未接入或已撤销")
		}
		if _, err = q.SetScheduling(r.Context(), sqlc.SetSchedulingParams{HostID: id, Enabled: enabled}); err != nil {
			return err
		}
		out = reportedCapacity(host.Report)
		out.Enabled = enabled
		return nil
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func (s *Service) getQuota(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		fail(w, r, notFound)
		return
	}
	q := sqlc.New(s.pool)
	if _, err := q.ActiveUser(r.Context(), id); err != nil {
		fail(w, r, err)
		return
	}
	out, err := quota(r.Context(), q, id)
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func (s *Service) setQuota(w http.ResponseWriter, r *http.Request) {
	var in struct {
		MaxEnvironments int32 `json:"max_environments"`
		MaxRunning      int32 `json:"max_running"`
		CPUMillis       int64 `json:"cpu_millis"`
		MemoryBytes     int64 `json:"memory_bytes"`
		StorageBytes    int64 `json:"storage_bytes"`
	}
	if !decode(w, r, &in) {
		return
	}
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) || in.MaxEnvironments < 0 || in.MaxEnvironments > 1000 || in.MaxRunning < 0 || in.MaxRunning > in.MaxEnvironments || in.CPUMillis < 0 || in.CPUMillis > 4096000 || in.MemoryBytes < 0 || in.MemoryBytes > 16<<40 || in.StorageBytes < 0 || in.StorageBytes > 1<<50 {
		fail(w, r, bad("用户额度无效"))
		return
	}
	var out sqlc.EnvironmentQuota
	err := s.transaction(r.Context(), func(q *sqlc.Queries) error {
		if _, err := q.ActiveUser(r.Context(), id); err != nil {
			return err
		}
		usage, err := q.UserUsage(r.Context(), id)
		if err != nil {
			return err
		}
		if int64(in.MaxEnvironments) < usage.Environments || int64(in.MaxRunning) < usage.Running || in.CPUMillis < usage.CpuMillis || in.MemoryBytes < usage.MemoryBytes {
			return conflict("quota_in_use", "额度不能低于已有预留")
		}
		out, err = q.SetQuota(r.Context(), sqlc.SetQuotaParams{UserID: id, MaxEnvironments: in.MaxEnvironments, MaxRunning: in.MaxRunning, CpuMillis: in.CPUMillis, MemoryBytes: in.MemoryBytes, StorageBytes: 0})
		return err
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
