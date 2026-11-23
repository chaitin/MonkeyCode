package identity

import (
	"bytes"
	"context"
	"errors"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/jackc/pgx/v5"
)

var ErrRuntimeUnavailable = errors.New("云环境当前不可执行")

type RuntimeAccess interface {
	RuntimeAllowed(context.Context, pgx.Tx, string, string) (bool, error)
}

func (s *Service) WithRuntimeAccess(access RuntimeAccess) *Service {
	s.runtimeAccess = access
	return s
}
func (s *Service) runtimeAllowed(ctx context.Context, tx pgx.Tx, user, machine string) (bool, error) {
	if machine == "" {
		return true, nil
	}
	if s.runtimeAccess != nil {
		return s.runtimeAccess.RuntimeAllowed(ctx, tx, user, machine)
	}
	// 切回开源版后仍可能存在已签发的云电脑凭据。
	q := sqlc.New(s.db)
	if tx != nil {
		q = sqlc.New(tx)
	}
	cloud, err := q.IsCloudMachine(ctx, machine)
	return !cloud && err == nil, err
}

// 仅由环境控制事务调用；设备码不是独立的宿主授权凭据。
func (s *Service) ApproveRuntime(ctx context.Context, tx pgx.Tx, user, machine string, public []byte, code string) (string, error) {
	code, valid := canonicalUserCode(code)
	if !valid || !s.deviceEnabled() {
		return "", errors.New("设备申请无效")
	}
	q := sqlc.New(tx)
	request, err := q.LockDeviceUserCode(ctx, s.userCodeHash(code))
	if err != nil {
		return "", err
	}
	if request.ClientID != RuntimeClientID || request.MachineID != machine || !bytes.Equal(request.ExecutionPublicKey, public) || request.Platform != "linux" || request.RestoreRevoked || !s.now().Before(request.ExpiresAt) {
		return "", errors.New("设备申请与云环境身份不符")
	}
	if _, err = q.LockDeviceOwner(ctx, user); err != nil {
		return "", err
	}
	revoked, err := s.device.registry.VerifyDeviceRequest(ctx, tx, user, machine, public)
	if err != nil {
		return "", err
	}
	if revoked {
		return "", errors.New("已撤销设备不能自动恢复")
	}
	if request.Status == "approved" || request.Status == "consumed" {
		if request.OwnerUserID == nil || *request.OwnerUserID != user {
			return "", errors.New("设备申请已归属其他授权")
		}
		return request.ID, nil
	}
	if request.Status != "pending" {
		return "", errors.New("设备申请已结束")
	}
	n, err := q.DecideDeviceRequest(ctx, sqlc.DecideDeviceRequestParams{ID: request.ID, Status: "approved", OwnerUserID: &user, ApprovedScopes: runtimeScopes})
	if err != nil {
		return "", err
	}
	if n != 1 {
		return "", errors.New("设备申请已被处理")
	}
	err = audit.Write(ctx, tx, audit.Event{ActorID: user, Action: "device.cloud_approved", Category: "security", TargetType: "endpoint", TargetID: machine, Params: map[string]any{"request_id": request.ID, "scopes": runtimeScopes}})
	return request.ID, err
}

func (s *Service) RevokeRuntime(ctx context.Context, tx pgx.Tx, user, machine string) ([]string, error) {
	return s.RevokeDeviceGrants(ctx, tx, user, machine, "environment_deleted")
}

func (s *Service) RevokeDeviceGrants(ctx context.Context, tx pgx.Tx, user, machine, reason string) ([]string, error) {
	q := sqlc.New(tx)
	ids, err := q.RevokeRuntimeMachine(ctx, sqlc.RevokeRuntimeMachineParams{UserID: user, MachineID: &machine, Reason: reason})
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if err = q.RevokeGrantTokens(ctx, id); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func (s *Service) CheckRuntime(ctx context.Context, tx pgx.Tx, user, machine string, public []byte) error {
	if !s.deviceEnabled() {
		return errors.New("设备授权不可用")
	}
	revoked, err := s.device.registry.VerifyDeviceRequest(ctx, tx, user, machine, public)
	if err != nil {
		return err
	}
	if revoked {
		return errors.New("已撤销设备不能自动恢复")
	}
	return nil
}
