package environment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type RuntimeUpdate struct {
	Generation int64  `json:"generation"`
	RequestKey string `json:"request_key"`
	Version    string `json:"version,omitempty"`
}
type RuntimeInfo struct {
	CurrentVersion  string     `json:"current_version"`
	LatestVersion   string     `json:"latest_version"`
	TargetVersion   string     `json:"target_version,omitempty"`
	UpdateAvailable bool       `json:"update_available"`
	CanUpdate       bool       `json:"can_update"`
	Reason          string     `json:"reason,omitempty"`
	Operation       *Operation `json:"operation,omitempty"`
}

func (s *Service) runtimeInfo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuid.MatchString(id) {
		fail(w, r, notFound)
		return
	}
	query := sqlc.New(s.pool)
	environment, err := query.GetEnvironment(r.Context(), sqlc.GetEnvironmentParams{ID: id, UserID: owner(r, false)})
	if err != nil {
		fail(w, r, err)
		return
	}
	runtime, err := query.GetRuntime(r.Context(), environment.ID)
	if err != nil {
		fail(w, r, err)
		return
	}
	info := RuntimeInfo{CurrentVersion: runtime.RuntimeVersion}
	if op, err := query.RuntimeOperation(r.Context(), sqlc.RuntimeOperationParams{EnvironmentID: id, Generation: environment.Generation}); err == nil && op.Kind == "runtime_upgrade" {
		item := operation(op)
		info.Operation = &item
		info.TargetVersion = op.TargetVersion
	}
	if environment.Desired == "deleted" {
		info.Reason = "环境已删除"
		respond(w, r, 200, info)
		return
	}
	if s.runtimeCatalog == nil {
		info.Reason = "server 尚未配置 runtime 发行资源"
		respond(w, r, 200, info)
		return
	}
	host, err := query.HostStatus(r.Context(), environment.HostID)
	if err != nil {
		fail(w, r, err)
		return
	}
	latest, err := s.runtimeCatalog.Current(host.Architecture)
	if err != nil {
		info.Reason = "server runtime 资源尚未准备完成"
		respond(w, r, 200, info)
		return
	}
	info.LatestVersion = latest.Version
	info.UpdateAvailable = newerRuntime(latest.Version, info.CurrentVersion)
	spec, decodeErr := executionSpec(environment)
	if decodeErr != nil {
		fail(w, r, errors.New("环境规格无效"))
		return
	}
	var report struct {
		Protocol int `json:"runtime_update_protocol"`
	}
	_ = json.Unmarshal(host.Report, &report)
	switch {
	case environment.Desired == "deleted":
		info.Reason = "环境已删除"
	case !spec.PersistentContainer || spec.Runtime == nil:
		info.Reason = "环境尚不支持保留容器更新 runtime"
	case environment.Desired != "stopped" || environment.ObservedGeneration != environment.Generation || environment.Phase != "stopped" && environment.Phase != "failed":
		info.Reason = "请先停止环境并等待宿主确认"
	case environment.Phase == "failed" && info.Operation == nil:
		info.Reason = "请先确认容器已停止"
	case host.Status != "active" || host.LastSeenAt == nil || time.Since(*host.LastSeenAt) > 90*time.Second:
		info.Reason = "宿主离线"
	case report.Protocol < latest.Protocol() || report.Protocol > 2:
		info.Reason = "请先升级宿主引擎"
	default:
		info.CanUpdate = true
	}
	respond(w, r, 200, info)
}
func (s *Service) runtimeUpgrade(w http.ResponseWriter, r *http.Request) {
	var in RuntimeUpdate
	if !decode(w, r, &in) {
		return
	}
	out, err := s.UpdateRuntime(r.Context(), *owner(r, false), chi.URLParam(r, "id"), in)
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 202, out)
}
func (s *Service) UpdateRuntime(ctx context.Context, user, id string, in RuntimeUpdate) (Result, error) {
	var result Result
	if !uuid.MatchString(user) || !uuid.MatchString(id) || in.Generation < 1 || !key.MatchString(in.RequestKey) || in.Version != "" && !runtimeVersion.MatchString(in.Version) {
		return result, bad("runtime 更新参数无效")
	}
	requestHash := hash(in)
	err := s.transaction(ctx, func(q *sqlc.Queries) error {
		env, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: id, UserID: &user})
		if err != nil {
			return err
		}
		runtime, err := q.GetRuntime(ctx, env.ID)
		if err != nil {
			return err
		}
		op, err := q.FindOperation(ctx, sqlc.FindOperationParams{EnvironmentID: id, RequestKey: in.RequestKey})
		if err == nil {
			if op.Kind != "runtime_upgrade" || op.RequestHash != requestHash {
				return conflict("idempotency_conflict", "幂等键已用于其他操作")
			}
			result = Result{withRuntime(view(env), runtime), operation(op)}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if s.runtimeCatalog == nil {
			return &failure{503, "runtime_update_unavailable", "server 尚未配置 runtime 发行资源"}
		}
		if env.Generation != in.Generation {
			return conflict("generation_conflict", "环境代次已变化，请重新查询")
		}
		if env.Desired == "deleted" {
			return conflict("environment_deleted", "环境已删除")
		}
		if env.Desired != "stopped" || env.ObservedGeneration != env.Generation || env.Phase != "stopped" && env.Phase != "failed" {
			return conflict("environment_must_stop", "请先停止环境并等待宿主确认")
		}
		if env.Phase == "failed" {
			previous, err := q.RuntimeOperation(ctx, sqlc.RuntimeOperationParams{EnvironmentID: id, Generation: env.Generation})
			if err != nil || previous.Kind != "runtime_upgrade" {
				return conflict("environment_must_stop", "请先确认容器已停止")
			}
		}
		if _, err := q.ActiveUser(ctx, user); errors.Is(err, pgx.ErrNoRows) {
			return notFound
		} else if err != nil {
			return err
		}
		spec, err := executionSpec(env)
		if err != nil {
			return err
		}
		if !spec.PersistentContainer || spec.Runtime == nil {
			return conflict("runtime_update_unsupported", "环境尚不支持保留容器更新 runtime")
		}
		host, err := q.HostStatus(ctx, env.HostID)
		if err != nil {
			return err
		}
		var report struct {
			Protocol int `json:"runtime_update_protocol"`
		}
		if err := json.Unmarshal(host.Report, &report); err != nil {
			return err
		}
		if host.Status != "active" || host.LastSeenAt == nil || time.Since(*host.LastSeenAt) > 90*time.Second {
			return conflict("host_unavailable", "宿主离线")
		}
		if report.Protocol < 1 || report.Protocol > 2 {
			return conflict("runtime_update_unsupported", "请先升级宿主引擎")
		}
		var release RuntimePackage
		if in.Version == "" {
			release, err = s.runtimeCatalog.Current(host.Architecture)
		} else {
			release, err = s.runtimeCatalog.Get(in.Version, host.Architecture)
		}
		if err != nil {
			return conflict("runtime_update_unavailable", "server 没有对应 runtime 发行资源")
		}
		if report.Protocol < release.Protocol() {
			return conflict("runtime_update_unsupported", "请先升级宿主引擎")
		}
		if err := release.Validate(host.Architecture); err != nil {
			return err
		}
		if in.Version == "" && runtime.RuntimeVersion != "" && !newerRuntime(release.Version, runtime.RuntimeVersion) && release.Version != runtime.RuntimeVersion {
			return conflict("runtime_downgrade_requires_version", "回退 runtime 需要显式指定 server 已有版本")
		}
		if release.Version == runtime.RuntimeVersion {
			return conflict("runtime_already_current", "runtime 已是目标版本")
		}
		spec.Generation++
		spec.RuntimePackage = &release
		raw := saveSpec(spec)
		if err := q.SupersedeOperations(ctx, id); err != nil {
			return err
		}
		env, err = q.ChangeTarget(ctx, sqlc.ChangeTargetParams{ID: id, InstanceID: env.InstanceID, Desired: "stopped", Spec: raw})
		if err != nil {
			return err
		}
		op, err = q.CreateRuntimeUpgradeOperation(ctx, sqlc.CreateRuntimeUpgradeOperationParams{EnvironmentID: id, Generation: env.Generation, TargetVersion: release.Version, RequestKey: in.RequestKey, RequestHash: requestHash})
		if err != nil {
			return err
		}
		result = Result{withRuntime(view(env), runtime), operation(op)}
		return nil
	})
	return result, err
}
