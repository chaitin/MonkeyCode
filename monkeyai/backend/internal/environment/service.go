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
	pool       *pgxpool.Pool
	runtime    *runtimeConfig
	disconnect func(string, string)
	ready      RuntimeReadiness
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

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
	// 首期串行化容量预留及状态更新，统一锁顺序避免用户和宿主额度交叉死锁。
	if _, err := q.LockControl(ctx); err != nil {
		return err
	}
	if err := fn(q, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type Creation struct {
	PresetID   string `json:"preset_id"`
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
	var result Result
	if !uuid.MatchString(user) || !uuid.MatchString(in.PresetID) || !validName(in.Name) || !key.MatchString(in.RequestKey) {
		return result, bad("预设、名称或幂等键无效")
	}
	err := s.transaction(ctx, func(q *sqlc.Queries) error {
		if _, err := q.ActiveUser(ctx, user); errors.Is(err, pgx.ErrNoRows) {
			return notFound
		} else if err != nil {
			return err
		}
		existing, err := q.FindCreation(ctx, sqlc.FindCreationParams{UserID: user, RequestKey: in.RequestKey})
		if err == nil {
			if existing.RequestHash != hash(in) {
				return conflict("idempotency_conflict", "幂等键已用于不同创建请求")
			}
			op, err := q.FindOperation(ctx, sqlc.FindOperationParams{EnvironmentID: existing.ID, RequestKey: in.RequestKey})
			if err != nil {
				return err
			}
			result = Result{view(existing), operation(op)}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		preset, err := q.GetPreset(ctx, in.PresetID)
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound
		}
		if err != nil {
			return err
		}
		if !preset.Enabled {
			return conflict("preset_disabled", "预设已停用")
		}
		var profile Profile
		if err := json.Unmarshal(preset.Configuration, &profile); err != nil {
			return err
		}
		if err := profile.Validate(); err != nil {
			return err
		}
		if err := reserveUser(ctx, q, user, preset.CpuMillis, preset.MemoryBytes, preset.StorageBytes, true); err != nil {
			return err
		}
		candidates, err := q.AvailableHosts(ctx, sqlc.AvailableHostsParams{Architecture: preset.Architecture, NetworkPolicy: profile.NetworkPolicy, RuntimeRequired: s.runtime != nil})
		if err != nil {
			return err
		}
		var hostID string
		for _, host := range candidates {
			usage, err := q.HostUsage(ctx, host.HostID)
			if err != nil {
				return err
			}
			if usage.Environments < int64(host.MaxEnvironments) && fits(host.CpuMillis, usage.CpuMillis, preset.CpuMillis) && fits(host.MemoryBytes, usage.MemoryBytes, preset.MemoryBytes) && fits(host.StorageBytes, usage.StorageBytes, preset.StorageBytes) {
				hostID = host.HostID
				break
			}
		}
		if hostID == "" {
			return conflict("capacity_unavailable", "没有在线且容量充足的已启用宿主")
		}
		id := resource.ID()
		spec := profile.Spec(id)
		if s.runtime != nil {
			if profile.NetworkPolicy != "public-only" {
				return conflict("runtime_network_required", "云环境需要 public-only 网络访问后台")
			}
			spec.Runtime = &Runtime{Server: s.runtime.server, ServerID: s.runtime.serverID, UserID: user}
		}
		raw, _ := json.Marshal(spec)
		env, err := q.CreateEnvironment(ctx, sqlc.CreateEnvironmentParams{ID: id, UserID: user, HostID: hostID, PresetID: preset.ID, Name: in.Name, InstanceID: spec.InstanceID, Spec: raw, CpuMillis: preset.CpuMillis, MemoryBytes: preset.MemoryBytes, StorageBytes: preset.StorageBytes, RequestKey: in.RequestKey, RequestHash: hash(in)})
		if err != nil {
			return err
		}
		op, err := q.CreateOperation(ctx, sqlc.CreateOperationParams{EnvironmentID: id, Generation: 1, Desired: "running", RequestKey: in.RequestKey, RequestHash: hash(in)})
		if err != nil {
			return err
		}
		result = Result{view(env), operation(op)}
		return nil
	})
	return result, err
}
func fits(capacity, used, add int64) bool {
	return add >= 0 && used >= 0 && used <= capacity && add <= capacity-used
}
func quota(ctx context.Context, q *sqlc.Queries, user string) (sqlc.EnvironmentQuota, error) {
	out, err := q.GetQuota(ctx, user)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.EnvironmentQuota{UserID: user, MaxEnvironments: 3, MaxRunning: 2, CpuMillis: 8000, MemoryBytes: 16 << 30, StorageBytes: 100 << 30}, nil
	}
	return out, err
}
func reserveUser(ctx context.Context, q *sqlc.Queries, user string, cpu, memory, storage int64, creating bool) error {
	limits, err := quota(ctx, q, user)
	if err != nil {
		return err
	}
	usage, err := q.UserUsage(ctx, user)
	if err != nil {
		return err
	}
	if (creating && usage.Environments >= int64(limits.MaxEnvironments)) || usage.Running >= int64(limits.MaxRunning) || !fits(limits.CpuMillis, usage.CpuMillis, cpu) || !fits(limits.MemoryBytes, usage.MemoryBytes, memory) || !fits(limits.StorageBytes, usage.StorageBytes, storage) {
		return conflict("quota_exceeded", "用户环境或资源额度不足")
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
		env, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: id, UserID: user})
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound
		}
		if err != nil {
			return err
		}
		if desired == "deleted" && s.runtime != nil {
			binding, lookupErr := q.RuntimeBinding(ctx, id)
			if lookupErr == nil {
				revoked, err = s.runtime.auth.RevokeRuntime(ctx, tx, env.UserID, binding.MachineID)
				if err != nil {
					return err
				}
			} else if !errors.Is(lookupErr, pgx.ErrNoRows) {
				return lookupErr
			}
		}
		op, err := q.FindOperation(ctx, sqlc.FindOperationParams{EnvironmentID: id, RequestKey: in.RequestKey})
		if err == nil {
			if op.RequestHash != requestHash {
				return conflict("idempotency_conflict", "幂等键已用于不同操作")
			}
			result = Result{view(env), operation(op)}
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
		var spec Spec
		if err := json.Unmarshal(env.Spec, &spec); err != nil {
			return err
		}
		if desired == "running" {
			if env.Desired != "stopped" || env.Phase != "stopped" || env.ObservedGeneration != env.Generation || env.ComputeReserved {
				return conflict("environment_must_stop", "必须先确认停止，才能创建新实例")
			}
			if _, err := q.ActiveUser(ctx, env.UserID); errors.Is(err, pgx.ErrNoRows) {
				return notFound
			} else if err != nil {
				return err
			}
			if err := reserveUser(ctx, q, env.UserID, env.CpuMillis, env.MemoryBytes, 0, false); err != nil {
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
				Ready           bool     `json:"prerequisites_met"`
				RuntimeProtocol int      `json:"runtime_protocol"`
				NetworkPolicies []string `json:"network_policies"`
			}
			json.Unmarshal(status.Report, &report)
			if !host.Enabled || host.Protocol != 1 || host.SyncAt == nil || time.Since(*host.SyncAt) > 90*time.Second || status.Status != "active" || status.LastSeenAt == nil || time.Since(*status.LastSeenAt) > 90*time.Second || !report.Ready || (spec.Runtime != nil && report.RuntimeProtocol != 1) || (spec.NetworkPolicy != "isolated" && !slices.Contains(report.NetworkPolicies, spec.NetworkPolicy)) {
				return conflict("host_unavailable", "原宿主尚不可用；不会自动迁移持久目录")
			}
			usage, err := q.HostUsage(ctx, env.HostID)
			if err != nil {
				return err
			}
			if !fits(host.CpuMillis, usage.CpuMillis, env.CpuMillis) || !fits(host.MemoryBytes, usage.MemoryBytes, env.MemoryBytes) {
				return conflict("capacity_unavailable", "原宿主计算容量不足")
			}
			spec.InstanceID = resource.ID()
		}
		spec.Generation++
		spec.DesiredState = desired
		raw, _ := json.Marshal(spec)
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
		result = Result{view(env), operation(op)}
		return nil
	})
	if err == nil && s.runtime != nil {
		for _, id := range revoked {
			s.runtime.auth.NotifyGrantRevoked(id)
		}
	}
	if err == nil && desired != "running" && s.disconnect != nil {
		binding, lookupErr := sqlc.New(s.pool).RuntimeBinding(ctx, id)
		if lookupErr == nil {
			s.disconnect(result.Environment.UserID, binding.MachineID)
		}
		if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
			return result, lookupErr
		}
	}
	return result, err
}
