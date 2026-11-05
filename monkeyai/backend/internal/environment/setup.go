package environment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type DefaultQuota struct {
	MaxEnvironments int32 `json:"max_environments"`
	MaxRunning      int32 `json:"max_running"`
	CPUMillis       int64 `json:"cpu_millis"`
	MemoryBytes     int64 `json:"memory_bytes"`
}
type SetupPreset struct {
	Name          string  `json:"name"`
	Configuration Profile `json:"configuration"`
}
type Setup struct {
	Revision int64        `json:"revision"`
	Preset   SetupPreset  `json:"preset"`
	Quota    DefaultQuota `json:"quota"`
}
type SetupView struct {
	Revision int64        `json:"revision"`
	Preset   any          `json:"preset"`
	Quota    DefaultQuota `json:"quota"`
	Capacity Capacity     `json:"capacity"`
}

func setupView(ctx context.Context, q *sqlc.Queries, host string) (SetupView, error) {
	defaults, err := q.GetDefaults(ctx)
	if err != nil {
		return SetupView{}, err
	}
	out := SetupView{Revision: defaults.Revision, Quota: DefaultQuota{defaults.MaxEnvironments, defaults.MaxRunning, defaults.CpuMillis, defaults.MemoryBytes}}
	capacity, err := q.GetHost(ctx, host)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	hostStatus, err := q.HostStatus(ctx, host)
	if err != nil {
		return out, err
	}
	out.Capacity = reportedCapacity(hostStatus.Report)
	out.Capacity.Enabled = capacity.Enabled
	if defaults.PresetID != nil {
		preset, err := q.GetPreset(ctx, *defaults.PresetID)
		if err != nil {
			return out, err
		}
		out.Preset = presetView(preset)
	}
	return out, nil
}
func (s *Service) getSetup(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		fail(w, r, notFound)
		return
	}
	var out SetupView
	err := s.transaction(r.Context(), func(q *sqlc.Queries) error {
		if _, err := q.HostStatus(r.Context(), id); err != nil {
			return err
		}
		var err error
		out, err = setupView(r.Context(), q, id)
		return err
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func (s *Service) putSetup(w http.ResponseWriter, r *http.Request) {
	var in Setup
	if !decode(w, r, &in) {
		return
	}
	out, err := s.saveSetup(r.Context(), chi.URLParam(r, "id"), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func (s *Service) saveSetup(ctx context.Context, id string, in Setup) (SetupView, error) {
	var out SetupView
	p, d := in.Preset, in.Quota
	if !uuid.MatchString(id) || in.Revision < 0 || !validName(p.Name) {
		return out, bad("配置参数无效")
	}
	if err := p.Configuration.Validate(); err != nil {
		return out, bad(err.Error())
	}
	if p.Configuration.NetworkPolicy != "public-only" {
		return out, bad("云环境必须使用公网出站网络")
	}
	if d.MaxEnvironments < 1 || d.MaxEnvironments > 1000 || d.MaxRunning < 1 || d.MaxRunning > d.MaxEnvironments || d.CPUMillis < 0 || d.CPUMillis > 4096000 || d.MemoryBytes < 0 || d.MemoryBytes > 16<<40 {
		return out, bad("默认用户配额无效")
	}
	resource := p.Configuration.Resource
	if d.CPUMillis < resource.CPUMillis || d.MemoryBytes < resource.MemoryBytes {
		return out, bad("默认配额至少需要容纳一个预设环境")
	}
	p.Configuration.Storage = Storage{}
	err := s.transaction(ctx, func(q *sqlc.Queries) error {
		host, err := q.HostStatus(ctx, id)
		if err != nil {
			return err
		}
		if host.Status != "active" {
			return conflict("host_unavailable", "宿主未接入或已撤销")
		}
		if host.Architecture != p.Configuration.Architecture {
			return bad("预设架构必须与宿主一致")
		}
		defaults, err := q.GetDefaults(ctx)
		if err != nil {
			return err
		}
		var previous sqlc.EnvironmentPreset
		same := false
		if defaults.PresetID != nil {
			previous, err = q.GetPreset(ctx, *defaults.PresetID)
			if err != nil {
				return err
			}
			var profile Profile
			if err = json.Unmarshal(previous.Configuration, &profile); err != nil {
				return err
			}
			same = previous.Name == p.Name && profile == p.Configuration && previous.Enabled
		}
		current, err := setupView(ctx, q, id)
		if err != nil {
			return err
		}
		if same && current.Quota == d {
			out = current
			return nil
		}
		if defaults.Revision != in.Revision {
			return conflict("configuration_conflict", "配置已被修改，请重新加载后保存")
		}
		used, err := q.DefaultQuotaInUse(ctx, sqlc.DefaultQuotaInUseParams{MaxEnvironments: d.MaxEnvironments, MaxRunning: d.MaxRunning, CpuMillis: d.CPUMillis, MemoryBytes: d.MemoryBytes})
		if err != nil {
			return err
		}
		if used {
			return conflict("quota_in_use", "默认配额不能低于使用默认配额用户的已有预留")
		}
		presetID := defaults.PresetID
		if !same {
			raw, _ := json.Marshal(p.Configuration)
			row, err := q.CreatePreset(ctx, sqlc.CreatePresetParams{Name: p.Name, Architecture: p.Configuration.Architecture, Configuration: raw, CpuMillis: resource.CPUMillis, MemoryBytes: resource.MemoryBytes})
			if err != nil {
				return err
			}
			presetID = &row.ID
			if defaults.PresetID != nil {
				if _, err = q.EnablePreset(ctx, sqlc.EnablePresetParams{ID: *defaults.PresetID, Enabled: false}); err != nil {
					return err
				}
			}
		}
		if _, err = q.SetDefaults(ctx, sqlc.SetDefaultsParams{PresetID: presetID, MaxEnvironments: d.MaxEnvironments, MaxRunning: d.MaxRunning, CpuMillis: d.CPUMillis, MemoryBytes: d.MemoryBytes}); err != nil {
			return err
		}
		out, err = setupView(ctx, q, id)
		return err
	})
	return out, err
}
