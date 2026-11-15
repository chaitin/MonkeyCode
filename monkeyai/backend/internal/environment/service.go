package environment

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool           *pgxpool.Pool
	runtime        *runtimeConfig
	disconnect     func(string, string)
	ready          RuntimeReadiness
	images         ImageResolver
	runtimeCatalog RuntimeCatalog
	credits        CreditBilling
	now            func() time.Time
	billingWake    chan struct{}
}

type ImageResolver interface {
	Default(context.Context, string) (string, string, error)
}

func (s *Service) WithImages(images ImageResolver) *Service { s.images = images; return s }

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, now: time.Now, billingWake: make(chan struct{}, 1)}
}

type failure struct {
	status        int
	code, message string
}

func (e *failure) Error() string          { return e.message }
func bad(message string) error            { return &failure{400, "invalid_request", message} }
func conflict(code, message string) error { return &failure{409, code, message} }

var notFound = &failure{404, "not_found", "资源不存在"}

func (s *Service) transaction(ctx context.Context, fn func(*sqlc.Queries) error) error {
	return s.transactionWithTx(ctx, func(q *sqlc.Queries, _ pgx.Tx) error { return fn(q) })
}
func (s *Service) transactionWithTx(ctx context.Context, fn func(*sqlc.Queries, pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	// 数量检查、分配及状态更新使用统一事务锁顺序。
	if err := q.LockControl(ctx); err != nil {
		return err
	}
	if err := fn(q, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type Creation struct {
	Name       string `json:"name"`
	RequestKey string `json:"request_key"`
}
type Change struct {
	Generation int64  `json:"generation"`
	RequestKey string `json:"request_key"`
}
type Result struct {
	Environment View      `json:"environment"`
	Operation   Operation `json:"operation"`
}

func (s *Service) Create(ctx context.Context, user string, in Creation) (Result, error) {
	return s.CreateOnHost(ctx, user, "", in)
}
func (s *Service) CreateOnHost(ctx context.Context, user, requestedHost string, in Creation) (Result, error) {
	var result Result
	if !uuid.MatchString(user) || !validName(in.Name) || !key.MatchString(in.RequestKey) || requestedHost != "" && !uuid.MatchString(requestedHost) {
		return result, bad("名称或幂等键无效")
	}
	requestHash := hash(in)
	if requestedHost != "" {
		requestHash = hash(resource.Object{"host_id": requestedHost, "name": in.Name, "request_key": in.RequestKey})
	}
	err := s.transactionWithTx(ctx, func(q *sqlc.Queries, tx pgx.Tx) error {
		if _, err := q.ActiveUser(ctx, user); errors.Is(err, pgx.ErrNoRows) {
			return notFound
		} else if err != nil {
			return err
		}
		existing, err := q.FindCreation(ctx, sqlc.FindCreationParams{UserID: user, RequestKey: in.RequestKey})
		if err == nil {
			if existing.RequestHash != requestHash {
				return conflict("idempotency_conflict", "幂等键已用于不同创建请求")
			}
			env, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: existing.EnvironmentID, UserID: &user})
			if err != nil {
				return err
			}
			result = Result{view(env), operation(existing)}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if s.images == nil {
			return conflict("configuration_unavailable", "server 尚未准备默认环境镜像")
		}
		selected, err := s.schedule(ctx, q, tx, user, requestedHost)
		if err != nil {
			return err
		}
		resources := selected.Resource
		hostID := selected.HostID
		profile := Profile{Architecture: selected.Architecture, Image: selected.Image, ImageDigest: selected.ImageDigest, NetworkPolicy: "public-only", Resource: resources}
		if err := profile.Validate(); err != nil {
			return err
		}
		id := resource.ID()
		spec := profile.Spec(id)
		host, err := q.HostStatus(ctx, hostID)
		if err != nil {
			return err
		}
		var capabilities struct {
			EnvironmentProtocol int `json:"environment_protocol"`
			RuntimeProtocol     int `json:"runtime_update_protocol"`
		}
		if err := json.Unmarshal(host.Report, &capabilities); err != nil {
			return err
		}
		spec.PersistentContainer = capabilities.EnvironmentProtocol >= 2 && capabilities.EnvironmentProtocol <= 3
		if s.runtime != nil {
			if profile.NetworkPolicy != "public-only" {
				return conflict("runtime_network_required", "云环境需要 public-only 网络访问后台")
			}
			spec.Runtime = &Runtime{Server: s.runtime.server, ServerID: s.runtime.serverID, UserID: user}
			if s.runtimeCatalog != nil {
				release, err := s.runtimeCatalog.Current(host.Architecture)
				if err != nil {
					return conflict("configuration_unavailable", "server runtime 发行资源尚未准备完成")
				}
				if !spec.PersistentContainer || capabilities.RuntimeProtocol < release.Protocol() || capabilities.RuntimeProtocol > 2 {
					return conflict("host_unavailable", "宿主引擎尚不支持独立 runtime")
				}
				spec.RuntimePackage = &release
			}
		}
		raw := saveSpec(spec)
		env, err := q.CreateEnvironment(ctx, sqlc.CreateEnvironmentParams{ID: id, UserID: user, HostID: hostID, Name: in.Name, InstanceID: spec.InstanceID, Spec: raw, CpuMillis: resources.CPUMillis, MemoryBytes: resources.MemoryBytes})
		if err != nil {
			return err
		}
		if err := q.CreateRuntime(ctx, id); err != nil {
			return err
		}
		op, err := q.CreateOperation(ctx, sqlc.CreateOperationParams{EnvironmentID: id, Generation: 1, Desired: "running", RequestKey: in.RequestKey, RequestHash: requestHash})
		if err != nil {
			return err
		}
		result = Result{view(env), operation(op)}
		return nil
	})
	return result, err
}
func quota(ctx context.Context, q *sqlc.Queries, user, host string) (int32, error) {
	row, err := q.GetQuota(ctx, sqlc.GetQuotaParams{UserID: user, HostID: host})
	if errors.Is(err, pgx.ErrNoRows) {
		h, err := q.HostSetup(ctx, host)
		return h.UserMaxEnvironments, err
	}
	return row.MaxEnvironments, err
}
func reserveUser(ctx context.Context, q *sqlc.Queries, user, host string) error {
	limit, err := quota(ctx, q, user, host)
	if err != nil {
		return err
	}
	used, err := q.UserHostUsage(ctx, sqlc.UserHostUsageParams{UserID: user, HostID: host})
	if err != nil {
		return err
	}
	if used >= int64(limit) {
		return conflict("quota_exceeded", "用户环境数量已达上限")
	}
	return nil
}
func (s *Service) Change(ctx context.Context, user *string, id, desired string, in Change) (Result, error) {
	var result Result
	if !uuid.MatchString(id) || in.Generation < 1 || !key.MatchString(in.RequestKey) || (desired != "running" && desired != "stopped" && desired != "deleted") {
		return result, bad("环境操作参数无效")
	}
	requestHash := hash(struct {
		Change
		Desired string
	}{in, desired})
	var revoked []string
	err := s.transactionWithTx(ctx, func(q *sqlc.Queries, tx pgx.Tx) error {
		env, err := q.LockEnvironment(ctx, sqlc.LockEnvironmentParams{ID: id, UserID: user})
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound
		}
		if err != nil {
			return err
		}
		runtime, err := q.GetRuntime(ctx, env.ID)
		if err != nil {
			return err
		}
		if desired == "deleted" && s.runtime != nil && runtime.MachineID != nil {
			revoked, err = s.runtime.auth.RevokeRuntime(ctx, tx, env.UserID, *runtime.MachineID)
			if err != nil {
				return err
			}
		}
		op, err := q.FindOperation(ctx, sqlc.FindOperationParams{EnvironmentID: id, RequestKey: in.RequestKey})
		if err == nil {
			if op.RequestHash != requestHash {
				return conflict("idempotency_conflict", "幂等键已用于不同操作")
			}
			result = Result{withRuntime(view(env), runtime), operation(op)}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if env.Generation != in.Generation {
			return conflict("generation_conflict", "环境版本已变化，请刷新后重试")
		}
		if env.Desired == "deleted" && desired != "deleted" {
			return conflict("environment_deleted", "环境已进入删除流程")
		}
		spec, err := executionSpec(env)
		if err != nil {
			return err
		}
		if desired == "running" {
			if env.Desired != "stopped" || env.Phase != "stopped" || env.ObservedGeneration != env.Generation {
				return conflict("environment_must_stop", "必须先确认停止，才能重新启动环境")
			}
			if _, err := q.ActiveUser(ctx, env.UserID); errors.Is(err, pgx.ErrNoRows) {
				return notFound
			} else if err != nil {
				return err
			}
			if err := hostAllowed(ctx, tx, env.HostID, env.UserID); err != nil {
				return err
			}
			if err := s.billingAdmission(ctx, q, tx, env.UserID, env.HostID); err != nil {
				return err
			}
			host, err := q.GetHost(ctx, env.HostID)
			if err != nil {
				return err
			}
			status, err := q.HostStatus(ctx, env.HostID)
			if err != nil {
				return err
			}
			var report struct {
				Ready               bool     `json:"prerequisites_met"`
				EnvironmentProtocol int      `json:"environment_protocol"`
				RuntimeProtocol     int      `json:"runtime_protocol"`
				NetworkPolicies     []string `json:"network_policies"`
			}
			json.Unmarshal(status.Report, &report)
			if host.Protocol != 1 || host.SyncAt == nil || time.Since(*host.SyncAt) > 90*time.Second || status.Status != "active" || status.LastSeenAt == nil || time.Since(*status.LastSeenAt) > 90*time.Second || !report.Ready || (spec.PersistentContainer && (report.EnvironmentProtocol < 2 || report.EnvironmentProtocol > 3)) || (imageTag.MatchString(spec.Image) && report.EnvironmentProtocol != 3) || (spec.Runtime != nil && report.RuntimeProtocol != 1) || (spec.NetworkPolicy != "isolated" && !slices.Contains(report.NetworkPolicies, spec.NetworkPolicy)) {
				return conflict("host_unavailable", "原宿主尚不可用；不会自动迁移持久目录")
			}
			if !spec.PersistentContainer {
				spec.InstanceID = resource.ID()
			}
			spec.PersistentContainer = report.EnvironmentProtocol >= 2 && report.EnvironmentProtocol <= 3
		}
		if desired == "stopped" && !spec.PersistentContainer {
			host, err := q.HostStatus(ctx, env.HostID)
			if err != nil {
				return err
			}
			var report struct {
				EnvironmentProtocol int `json:"environment_protocol"`
			}
			if err := json.Unmarshal(host.Report, &report); err != nil {
				return err
			}
			spec.PersistentContainer = report.EnvironmentProtocol >= 2 && report.EnvironmentProtocol <= 3
		}
		if desired == "stopped" {
			spec.RuntimePackage = nil
		}
		spec.Generation++
		spec.DesiredState = desired
		raw := saveSpec(spec)
		if err := q.SupersedeOperations(ctx, id); err != nil {
			return err
		}
		env, err = q.ChangeTarget(ctx, sqlc.ChangeTargetParams{ID: id, InstanceID: spec.InstanceID, Desired: desired, Spec: raw})
		if err != nil {
			return err
		}
		op, err = q.CreateOperation(ctx, sqlc.CreateOperationParams{EnvironmentID: id, Generation: env.Generation, Desired: desired, RequestKey: in.RequestKey, RequestHash: requestHash})
		if err != nil {
			return err
		}
		result = Result{withRuntime(view(env), runtime), operation(op)}
		return nil
	})
	if err == nil && s.runtime != nil {
		for _, id := range revoked {
			s.runtime.auth.NotifyGrantRevoked(id)
		}
	}
	if err == nil && desired != "running" && s.disconnect != nil && result.Environment.MachineID != nil {
		s.disconnect(result.Environment.UserID, *result.Environment.MachineID)
	}
	return result, err
}
