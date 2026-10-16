package session

import (
	"context"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/jackc/pgx/v5"
)

type HostAuthorizer interface {
	AuthenticateHost(context.Context, pgx.Tx, identity.Principal, string) (bool, error)
}

func (s *Service) WithHostAuthorizer(auth HostAuthorizer) *Service {
	s.hosts = auth
	return s
}

func reportingMachine(r *http.Request) (string, error) {
	p, ok := identity.PrincipalFromContext(r.Context())
	if !ok {
		return "", sessionFailure(http.StatusUnauthorized, "unauthorized", "缺少授权身份")
	}
	machine := strings.TrimSpace(r.Header.Get("X-MAI-Machine-ID"))
	if p.MachineID != "" {
		if machine != "" && machine != p.MachineID {
			return "", conflict("session_host_conflict", "请求机器与认证宿主不一致")
		}
		return p.MachineID, nil
	}
	if !validUUID(machine) {
		return "", invalidSession("X-MAI-Machine-ID 必须为 UUID")
	}
	return machine, nil
}

func (s *Service) authenticateHost(ctx context.Context, tx pgx.Tx, machine string) (bool, error) {
	if s.hosts == nil {
		return false, sessionFailure(http.StatusServiceUnavailable, "authorization_state_unavailable", "宿主认证暂不可用")
	}
	p, ok := identity.PrincipalFromContext(ctx)
	if !ok {
		return false, sessionFailure(http.StatusUnauthorized, "unauthorized", "缺少授权身份")
	}
	return s.hosts.AuthenticateHost(ctx, tx, p, machine)
}

func checkHostVerification(row sessionRow, verified bool) error {
	if row.HostVerified && !verified {
		return sessionFailure(http.StatusForbidden, "device_identity_required", "此会话需要认证宿主上报")
	}
	return nil
}
