package identity

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
)

func TestCloudApprovalUsesExactDeviceIdentity(t *testing.T) {
	for _, name := range []string{"成功与重试", "公钥替换", "机器替换", "权限扩大", "设备撤销", "请求过期", "用户停用"} {
		t.Run(name, func(t *testing.T) {
			s, user, _, registry := deviceService(t)
			device := deviceApplication(t, s)
			code, _ := canonicalUserCode(device.UserCode)
			request, err := sqlc.New(s.db).DeviceRequestByCode(t.Context(), s.userCodeHash(code))
			if err != nil {
				t.Fatal(err)
			}
			machine, public := request.MachineID, append([]byte(nil), request.ExecutionPublicKey...)
			switch name {
			case "公钥替换":
				public[0] ^= 1
			case "机器替换":
				machine = "11111111-1111-4111-8111-111111111111"
			case "权限扩大":
				_, err = s.db.Exec(t.Context(), `UPDATE oauth_device_requests SET requested_scopes=ARRAY['device:bind','device:publish','session:report','device:manage'] WHERE id=$1`, request.ID)
			case "设备撤销":
				registry.revoked = true
			case "请求过期":
				_, err = s.db.Exec(t.Context(), `UPDATE oauth_device_requests SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 second' WHERE id=$1`, request.ID)
			case "用户停用":
				_, err = s.db.Exec(t.Context(), `UPDATE users SET status='disabled' WHERE id=$1`, user.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			tx, err := s.db.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(t.Context())
			id, err := s.ApproveRuntime(t.Context(), tx, user.ID, machine, public, device.UserCode)
			if name != "成功与重试" {
				if err == nil {
					t.Fatal("批准了不匹配或失效的设备申请")
				}
				return
			}
			if err != nil || id != request.ID {
				t.Fatal("未批准匹配申请", err)
			}
			if err = tx.Commit(t.Context()); err != nil {
				t.Fatal(err)
			}
			again, err := s.db.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer again.Rollback(t.Context())
			if _, err = s.ApproveRuntime(t.Context(), again, user.ID, machine, public, device.UserCode); err != nil {
				t.Fatal("响应丢失后无法幂等重试", err)
			}
		})
	}
}

type runtimeGate struct{ allowed bool }

func (g *runtimeGate) RuntimeAllowed(context.Context, pgx.Tx, string, string) (bool, error) {
	return g.allowed, nil
}
func TestCloudGrantRetainedOnStopAndRevokedOnDelete(t *testing.T) {
	s, user, _, _ := deviceService(t)
	device := deviceApplication(t, s)
	code, _ := canonicalUserCode(device.UserCode)
	q := sqlc.New(s.db)
	request, err := q.DeviceRequestByCode(t.Context(), s.userCodeHash(code))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if _, err = s.ApproveRuntime(t.Context(), tx, user.ID, request.MachineID, request.ExecutionPublicKey, device.UserCode); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(t.Context(), `UPDATE oauth_device_requests SET next_poll_at=now()-interval '1 second' WHERE id=$1`, request.ID); err != nil {
		t.Fatal(err)
	}
	token, err := s.ExchangeDeviceCode(t.Context(), RuntimeClientID, device.DeviceCode)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := q.GetGrant(t.Context(), token.GrantID)
	if err != nil {
		t.Fatal(err)
	}
	p := Principal{UserID: user.ID, ClientID: RuntimeClientID, GrantID: grant.ID, Audience: grant.Audience, Purpose: grant.Purpose, RevocationVersion: grant.RevocationVersion, Scopes: grant.Scopes}
	gate := &runtimeGate{allowed: true}
	s.WithRuntimeAccess(gate)
	bind, err := s.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer bind.Rollback(t.Context())
	if valid, err := s.BindDevice(t.Context(), bind, p, request.MachineID, request.KeyID); err != nil || !valid {
		t.Fatal("未绑定匹配的设备授权", err)
	}
	if err = bind.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	p.MachineID = request.MachineID
	p.KeyID = request.KeyID
	gate.allowed = false
	if valid, err := s.VerifyGrant(t.Context(), p); !errors.Is(err, ErrRuntimeUnavailable) || valid {
		t.Fatal("停止后授权仍可用于执行", err)
	}
	gate.allowed = true
	if valid, err := s.VerifyGrant(t.Context(), p); err != nil || !valid {
		t.Fatal("普通停止错误地撤销了授权族", err)
	}
	deletion, err := s.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer deletion.Rollback(t.Context())
	ids, err := s.RevokeRuntime(t.Context(), deletion, user.ID, request.MachineID)
	if err != nil || len(ids) != 1 {
		t.Fatal("删除未撤销授权族", err)
	}
	if err = deletion.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if valid, err := s.VerifyGrant(t.Context(), p); err != nil || valid {
		t.Fatal("删除后恢复了授权", err)
	}
}
