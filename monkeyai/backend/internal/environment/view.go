package environment

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

type RuntimeReadiness interface {
	RuntimeReady(context.Context, string, string) (bool, error)
}

func (s *Service) WithReadiness(ready RuntimeReadiness) *Service { s.ready = ready; return s }

type View struct {
	MachineID          *string         `json:"machine_id"`
	RuntimeReady       bool            `json:"runtime_ready"`
	Connectable        bool            `json:"connectable"`
	Stale              bool            `json:"stale"`
	ID                 string          `json:"id"`
	UserID             string          `json:"user_id"`
	HostID             string          `json:"host_id"`
	PresetID           string          `json:"preset_id"`
	Name               string          `json:"name"`
	Generation         int64           `json:"generation"`
	InstanceID         string          `json:"instance_id"`
	Desired            string          `json:"desired"`
	Phase              string          `json:"phase"`
	ObservedGeneration int64           `json:"observed_generation"`
	ObservedAt         *time.Time      `json:"observed_at"`
	Reason             string          `json:"reason"`
	ComputeReserved    bool            `json:"compute_reserved"`
	StorageRetained    bool            `json:"storage_retained"`
	WorkloadVerified   bool            `json:"workload_verified"`
	Spec               json.RawMessage `json:"spec"`
	CreatedAt          time.Time       `json:"created_at"`
}

func view(e sqlc.Environment) View {
	return View{Stale: e.ObservedAt == nil || time.Since(*e.ObservedAt) > 90*time.Second, ID: e.ID, UserID: e.UserID, HostID: e.HostID, PresetID: e.PresetID, Name: e.Name, Generation: e.Generation, InstanceID: e.InstanceID, Desired: e.Desired, Phase: e.Phase, ObservedGeneration: e.ObservedGeneration, ObservedAt: e.ObservedAt, Reason: e.Reason, ComputeReserved: e.ComputeReserved, StorageRetained: true, Spec: e.Spec, CreatedAt: e.CreatedAt}
}

type Operation struct {
	ID            string     `json:"id"`
	EnvironmentID string     `json:"environment_id"`
	Generation    int64      `json:"generation"`
	Desired       string     `json:"desired"`
	Status        string     `json:"status"`
	Reason        string     `json:"reason"`
	CreatedAt     time.Time  `json:"created_at"`
	FinishedAt    *time.Time `json:"finished_at"`
}

func operation(o sqlc.EnvironmentOperation) Operation {
	return Operation{o.ID, o.EnvironmentID, o.Generation, o.Desired, o.Status, o.Reason, o.CreatedAt, o.FinishedAt}
}
func presetView(p sqlc.EnvironmentPreset) any {
	return struct {
		ID            string          `json:"id"`
		Name          string          `json:"name"`
		Enabled       bool            `json:"enabled"`
		Configuration json.RawMessage `json:"configuration"`
		CreatedAt     time.Time       `json:"created_at"`
	}{p.ID, p.Name, p.Enabled, p.Configuration, p.CreatedAt}
}

func (s *Service) environmentView(ctx context.Context, e sqlc.Environment) (View, error) {
	v := view(e)
	v.Stale = e.ObservedAt == nil || time.Since(*e.ObservedAt) > 90*time.Second
	binding, err := sqlc.New(s.pool).RuntimeBinding(ctx, e.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, nil
	}
	if err != nil {
		return v, err
	}
	v.MachineID = &binding.MachineID
	if s.ready != nil && !v.Stale && e.Desired == "running" && e.Phase == "running" && e.Generation == e.ObservedGeneration && binding.Generation == e.Generation && binding.InstanceID == e.InstanceID {
		v.RuntimeReady, err = s.ready.RuntimeReady(ctx, e.UserID, binding.MachineID)
		if err != nil {
			return v, err
		}
		v.Connectable = v.RuntimeReady
	}
	return v, nil
}
