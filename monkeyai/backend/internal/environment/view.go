package environment

import (
	"context"
	"encoding/json"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

type RuntimeReadiness interface {
	RuntimeReady(context.Context, string, string) (bool, error)
}

func (s *Service) WithReadiness(ready RuntimeReadiness) *Service { s.ready = ready; return s }

type UserIdentity struct {
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}
type HostIdentity struct {
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	OSName   string `json:"os_name"`
}

type View struct {
	RuntimeVersion     string          `json:"runtime_version"`
	Billing            *BillingView    `json:"billing,omitempty"`
	BillingStopReason  string          `json:"billing_stop_reason,omitempty"`
	UsageStale         bool            `json:"usage_stale"`
	Usage              *Usage          `json:"usage,omitempty"`
	User               *UserIdentity   `json:"user,omitempty"`
	Host               *HostIdentity   `json:"host,omitempty"`
	MachineID          *string         `json:"machine_id"`
	RuntimeReady       bool            `json:"runtime_ready"`
	Connectable        bool            `json:"connectable"`
	Stale              bool            `json:"stale"`
	ID                 string          `json:"id"`
	UserID             string          `json:"user_id"`
	HostID             string          `json:"host_id"`
	Name               string          `json:"name"`
	Generation         int64           `json:"generation"`
	InstanceID         string          `json:"instance_id"`
	Desired            string          `json:"desired"`
	Phase              string          `json:"phase"`
	ObservedGeneration int64           `json:"observed_generation"`
	ObservedAt         *time.Time      `json:"observed_at"`
	Reason             string          `json:"reason"`
	StorageRetained    bool            `json:"storage_retained"`
	WorkloadVerified   bool            `json:"workload_verified"`
	Spec               json.RawMessage `json:"spec"`
	CreatedAt          time.Time       `json:"created_at"`
}

func view(e sqlc.Environment) View {
	var usage *Usage
	if e.Desired == "running" && e.Phase == "running" && e.Generation == e.ObservedGeneration {
		_ = json.Unmarshal(e.Usage, &usage)
	}
	return View{BillingStopReason: e.BillingStopReason, Usage: usage, UsageStale: usage != nil && time.Since(usage.At) > 90*time.Second, Stale: e.ObservedAt == nil || time.Since(*e.ObservedAt) > 90*time.Second, ID: e.ID, UserID: e.UserID, HostID: e.HostID, Name: e.Name, Generation: e.Generation, InstanceID: e.InstanceID, Desired: e.Desired, Phase: e.Phase, ObservedGeneration: e.ObservedGeneration, ObservedAt: e.ObservedAt, Reason: e.Reason, StorageRetained: true, Spec: wireSpec(e), CreatedAt: e.CreatedAt}
}

type Operation struct {
	Kind          string     `json:"kind"`
	TargetVersion string     `json:"target_version,omitempty"`
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
	return Operation{Kind: o.Kind, TargetVersion: o.TargetVersion, ID: o.ID, EnvironmentID: o.EnvironmentID, Generation: o.Generation, Desired: o.Desired, Status: o.Status, Reason: o.Reason, CreatedAt: o.CreatedAt, FinishedAt: o.FinishedAt}
}
func withRuntime(v View, r sqlc.EnvironmentRuntime) View {
	v.MachineID = r.MachineID
	v.RuntimeVersion = r.RuntimeVersion
	return v
}

func (s *Service) environmentView(ctx context.Context, e sqlc.Environment) (View, error) {
	runtime, err := sqlc.New(s.pool).GetRuntime(ctx, e.ID)
	if err != nil {
		return View{}, err
	}
	return s.environmentViewWithRuntime(ctx, e, runtime)
}
func (s *Service) environmentViewWithRuntime(ctx context.Context, e sqlc.Environment, runtime sqlc.EnvironmentRuntime) (View, error) {
	v := withRuntime(view(e), runtime)
	v.Stale = e.ObservedAt == nil || time.Since(*e.ObservedAt) > 90*time.Second
	if s.ready != nil && !v.Stale && e.Desired == "running" && e.Phase == "running" && e.Generation == e.ObservedGeneration && runtimeCurrent(e, runtime) {
		var err error
		v.RuntimeReady, err = s.ready.RuntimeReady(ctx, e.UserID, *runtime.MachineID)
		if err != nil {
			return v, err
		}
		v.Connectable = v.RuntimeReady
	}
	return v, nil
}

func (s *Service) identities(ctx context.Context, items []View) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	rows, err := sqlc.New(s.pool).EnvironmentIdentities(ctx, ids)
	if err != nil {
		return err
	}
	byID := make(map[string]sqlc.EnvironmentIdentitiesRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	for i := range items {
		row, ok := byID[items[i].ID]
		if !ok {
			continue
		}
		items[i].User = &UserIdentity{Name: row.UserName, Email: row.UserEmail, AvatarURL: row.UserAvatar}
		items[i].Host = &HostIdentity{Name: row.HostName, Hostname: row.Hostname, OSName: row.OsName}
	}
	return nil
}
