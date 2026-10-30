package environment

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/jackc/pgx/v5"
)

type RuntimeAuthorizer interface {
	ApproveRuntime(context.Context, pgx.Tx, string, string, []byte, string) (string, error)
	CheckRuntime(context.Context, pgx.Tx, string, string, []byte) error
	RevokeRuntime(context.Context, pgx.Tx, string, string) ([]string, error)
	NotifyGrantRevoked(string)
}
type runtimeConfig struct {
	server, serverID string
	auth             RuntimeAuthorizer
}

func (s *Service) WithRuntime(server, serverID string, auth RuntimeAuthorizer) *Service {
	s.runtime = &runtimeConfig{server: server, serverID: serverID, auth: auth}
	return s
}
func (s *Service) WithDisconnect(fn func(string, string)) *Service { s.disconnect = fn; return s }

type RuntimeRequest struct {
	EnvironmentID string `json:"environment_id"`
	InstanceID    string `json:"instance_id"`
	Generation    int64  `json:"generation"`
	MachineID     string `json:"machine_id"`
	PublicKey     string `json:"public_key"`
	UserCode      string `json:"user_code,omitempty"`
}
type RuntimeReply struct {
	Request RuntimeRequest `json:"request"`
	Reason  string         `json:"reason"`
}

func (s *Service) approveRuntime(ctx context.Context, host string, in RuntimeRequest) error {
	public, err := base64.RawURLEncoding.Strict().DecodeString(in.PublicKey)
	if err != nil || len(public) != 32 || !uuid.MatchString(in.EnvironmentID) || !uuid.MatchString(in.InstanceID) || !uuid.MatchString(in.MachineID) || in.Generation < 1 || len(in.UserCode) > 16 || s.runtime == nil || s.runtime.auth == nil {
		return bad("运行时授权信息无效")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	if _, err = q.LockControl(ctx); err != nil {
		return err
	}
	status, err := q.HostStatus(ctx, host)
	if err != nil {
		return err
	}
	if status.Status != "active" || status.LastSeenAt == nil || time.Since(*status.LastSeenAt) > 90*time.Second {
		return conflict("host_unavailable", "宿主不可用")
	}
	env, err := q.HostEnvironment(ctx, sqlc.HostEnvironmentParams{ID: in.EnvironmentID, HostID: host})
	if err != nil {
		return err
	}
	if env.InstanceID != in.InstanceID || env.Generation != in.Generation || env.Desired != "running" || env.Phase == "failed" {
		return conflict("generation_conflict", "运行时实例已过期")
	}
	if _, err = q.ActiveUser(ctx, env.UserID); err != nil {
		return err
	}
	op, err := q.RuntimeOperation(ctx, sqlc.RuntimeOperationParams{EnvironmentID: env.ID, Generation: env.Generation})
	if err != nil {
		return err
	}
	if op.Desired != "running" || (op.Status != "pending" && op.Status != "succeeded") {
		return bad("缺少有效的启动操作")
	}
	var spec Spec
	if json.Unmarshal(env.Spec, &spec) != nil || spec.Runtime == nil || spec.Runtime.UserID != env.UserID || spec.Runtime.Server != s.runtime.server || spec.Runtime.ServerID != s.runtime.serverID {
		return bad("运行时规格无效")
	}
	binding, err := q.RuntimeBinding(ctx, env.ID)
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if exists && (binding.MachineID != in.MachineID || !bytes.Equal(binding.PublicKey, public)) {
		return conflict("runtime_identity_conflict", "运行时身份已变化")
	}
	if err := s.runtime.auth.CheckRuntime(ctx, tx, env.UserID, in.MachineID, public); err != nil {
		return err
	}
	requestID := binding.RequestID
	if in.UserCode != "" {
		requestID, err = s.runtime.auth.ApproveRuntime(ctx, tx, env.UserID, in.MachineID, public, in.UserCode)
		if err != nil {
			return err
		}
	} else if !exists {
		return bad("首次身份关联必须包含设备申请")
	}
	if err = q.BindRuntime(ctx, sqlc.BindRuntimeParams{EnvironmentID: env.ID, MachineID: in.MachineID, PublicKey: public, InstanceID: in.InstanceID, Generation: in.Generation, RequestID: requestID}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) RuntimeAllowed(ctx context.Context, tx pgx.Tx, user, machine string) (bool, error) {
	q := sqlc.New(s.pool)
	if tx != nil {
		q = sqlc.New(tx)
		if _, err := q.LockRuntimeEnvironment(ctx, machine); err != nil {
			return false, err
		}
	}
	allowed, err := q.RuntimeAccess(ctx, sqlc.RuntimeAccessParams{UserID: user, MachineID: machine})
	return allowed != nil && *allowed, err
}
