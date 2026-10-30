package environment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

type Observation struct {
	EnvironmentID string `json:"environment_id"`
	InstanceID    string `json:"instance_id"`
	Generation    int64  `json:"generation"`
	Phase         string `json:"phase"`
	Reason        string `json:"reason"`
}
type Exchange struct {
	Protocol int              `json:"protocol"`
	Cursor   string           `json:"cursor"`
	Results  []Observation    `json:"results"`
	Runtime  []RuntimeRequest `json:"runtime,omitempty"`
}
type Commands struct {
	Protocol     int               `json:"protocol"`
	Targets      []json.RawMessage `json:"targets"`
	Cursor       string            `json:"cursor"`
	Acknowledged []Observation     `json:"acknowledged"`
	Runtime      []RuntimeReply    `json:"runtime,omitempty"`
}

func validObservation(o Observation) bool {
	if !uuid.MatchString(o.EnvironmentID) || !uuid.MatchString(o.InstanceID) || o.Generation < 1 {
		return false
	}
	if o.Phase != "running" && o.Phase != "stopped" && o.Phase != "deleted" && o.Phase != "failed" {
		return false
	}
	switch o.Reason {
	case "", "apply_failed", "inspect_failed", "process_exited", "local_state_conflict", "runtime_failed":
		return o.Phase == "failed" || o.Reason == ""
	}
	return false
}
func (s *Service) Exchange(ctx context.Context, host string, raw json.RawMessage) (any, error) {
	var in Exchange
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) > 32<<10 || d.Decode(&in) != nil || d.Decode(new(any)) != io.EOF || in.Protocol != 1 || len(in.Results) > 16 || len(in.Runtime) > 16 || !uuid.MatchString(host) || (in.Cursor != "" && !uuid.MatchString(in.Cursor)) {
		return nil, bad("宿主同步格式无效")
	}
	seen := map[string]bool{}
	for _, o := range in.Results {
		if !validObservation(o) || seen[o.EnvironmentID] {
			return nil, bad("宿主状态报告无效或重复")
		}
		seen[o.EnvironmentID] = true
	}
	out := Commands{Protocol: 1, Targets: []json.RawMessage{}, Acknowledged: in.Results}
	err := s.transaction(ctx, func(q *sqlc.Queries) error {
		status, err := q.HostStatus(ctx, host)
		if err != nil {
			return err
		}
		if status.Status != "active" {
			return errors.New("宿主已撤销")
		}
		if err := q.TouchHost(ctx, host); err != nil {
			return err
		}
		for _, o := range in.Results {
			env, err := q.HostEnvironment(ctx, sqlc.HostEnvironmentParams{ID: o.EnvironmentID, HostID: host})
			if errors.Is(err, pgx.ErrNoRows) {
				return bad("报告不属于当前宿主")
			}
			if err != nil {
				return err
			}
			if env.Generation != o.Generation || env.InstanceID != o.InstanceID {
				continue
			}
			if o.Phase != "failed" && o.Phase != env.Desired {
				return bad("报告阶段与目标不一致")
			}
			if env.Phase == "failed" && env.ObservedGeneration == o.Generation && o.Phase != "failed" {
				continue
			}
			if _, err := q.ReportState(ctx, sqlc.ReportStateParams{ID: env.ID, HostID: host, InstanceID: o.InstanceID, ObservedGeneration: o.Generation, Phase: o.Phase, Reason: o.Reason}); err != nil {
				return err
			}
			if o.Phase == "running" {
				var spec Spec
				if err := json.Unmarshal(env.Spec, &spec); err != nil {
					return err
				}
				if spec.Runtime != nil {
					if s.ready == nil {
						continue
					}
					binding, err := q.RuntimeBinding(ctx, env.ID)
					if err != nil {
						return err
					}
					if binding.InstanceID != env.InstanceID || binding.Generation != env.Generation {
						continue
					}
					ready, err := s.ready.RuntimeReady(ctx, env.UserID, binding.MachineID)
					if err != nil {
						return err
					}
					if !ready {
						continue
					}
				}
			}
			result := "succeeded"
			if o.Phase == "failed" {
				result = "failed"
			}
			if err := q.CompleteOperation(ctx, sqlc.CompleteOperationParams{EnvironmentID: env.ID, Generation: o.Generation, Status: result, Reason: o.Reason}); err != nil {
				return err
			}
		}
		disabled, err := q.InactiveTargets(ctx, host)
		if err != nil {
			return err
		}
		for _, env := range disabled {
			var spec Spec
			if err := json.Unmarshal(env.Spec, &spec); err != nil {
				return err
			}
			spec.Generation++
			spec.DesiredState = "stopped"
			raw, _ := json.Marshal(spec)
			if err := q.SupersedeOperations(ctx, env.ID); err != nil {
				return err
			}
			if _, err := q.ChangeTarget(ctx, sqlc.ChangeTargetParams{ID: env.ID, InstanceID: env.InstanceID, Desired: "stopped", Spec: raw}); err != nil {
				return err
			}
			if _, err := q.CreateOperation(ctx, sqlc.CreateOperationParams{EnvironmentID: env.ID, Generation: spec.Generation, Desired: "stopped", RequestKey: "disabled-" + resource.ID(), RequestHash: hash("user_disabled")}); err != nil {
				return err
			}
		}
		cursor := in.Cursor
		if cursor == "" {
			cursor = "00000000-0000-0000-0000-000000000000"
		}
		rows, err := q.Targets(ctx, sqlc.TargetsParams{HostID: host, Cursor: cursor})
		if err != nil {
			return err
		}
		for _, env := range rows {
			out.Targets = append(out.Targets, json.RawMessage(env.Spec))
		}
		if len(rows) == 16 {
			out.Cursor = rows[len(rows)-1].ID
		}
		return nil
	})
	if err == nil && s.disconnect != nil {
		for _, o := range in.Results {
			if o.Phase != "failed" {
				continue
			}
			e, lookupErr := sqlc.New(s.pool).HostEnvironment(ctx, sqlc.HostEnvironmentParams{ID: o.EnvironmentID, HostID: host})
			if lookupErr == nil && e.Generation == o.Generation && e.InstanceID == o.InstanceID && e.Phase == "failed" {
				binding, lookupErr := sqlc.New(s.pool).RuntimeBinding(ctx, e.ID)
				if lookupErr == nil {
					s.disconnect(e.UserID, binding.MachineID)
				}
			}
		}
	}
	if err == nil {
		for _, request := range in.Runtime {
			reason := ""
			if err := s.approveRuntime(ctx, host, request); err != nil {
				reason = "runtime_authorization_rejected"
			}
			out.Runtime = append(out.Runtime, RuntimeReply{Request: request, Reason: reason})
		}
	}
	return out, err
}
