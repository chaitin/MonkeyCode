package identity

import (
	"context"
	"errors"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/jackc/pgx/v5"
)

var ErrDeviceBindingConflict = errors.New("授权族已经绑定其他设备或公钥")

func (s *Service) lockDeviceGrant(ctx context.Context, tx pgx.Tx, p Principal, scope string) (sqlc.LockGrantRow, bool, error) {
	g, err := sqlc.New(tx).LockGrant(ctx, p.GrantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, false, nil
	}
	if err != nil {
		return g, false, err
	}
	if g.UserID != p.UserID || g.ClientID != p.ClientID || g.Audience != p.Audience || g.Purpose != p.Purpose || g.RevocationVersion != p.RevocationVersion ||
		g.RevokedAt != nil || !s.now().Before(g.ExpiresAt) || g.UserStatus != "active" || g.UserDeletedAt != nil ||
		scope != "" && (!p.Has(scope) || !slices.Contains(g.Scopes, scope)) {
		return g, false, nil
	}
	for _, value := range p.Scopes {
		if !slices.Contains(g.Scopes, value) {
			return g, false, nil
		}
	}
	return g, true, nil
}

func (s *Service) AuthorizeDevice(ctx context.Context, tx pgx.Tx, p Principal, scope string) (bool, error) {
	_, valid, err := s.lockDeviceGrant(ctx, tx, p, scope)
	return valid, err
}

func (s *Service) BindDevice(ctx context.Context, tx pgx.Tx, p Principal, machineID, keyID string) (bool, error) {
	g, valid, err := s.lockDeviceGrant(ctx, tx, p, "device:bind")
	if err != nil || !valid {
		return false, err
	}
	if g.Purpose == "runtime" && (g.RequestedMachineID == nil || g.RequestedKeyID == nil || *g.RequestedMachineID != machineID || *g.RequestedKeyID != keyID) {
		return false, ErrDeviceBindingConflict
	}
	if g.MachineID != nil && (*g.MachineID != machineID || g.KeyID == nil || *g.KeyID != keyID) {
		return false, ErrDeviceBindingConflict
	}
	changed, err := sqlc.New(tx).BindGrant(ctx, sqlc.BindGrantParams{ID: g.ID, MachineID: new(machineID), KeyID: new(keyID)})
	return changed == 1, err
}

func (s *Service) ConsumeRuntimeRestore(ctx context.Context, tx pgx.Tx, p Principal) (bool, error) {
	g, valid, err := s.lockDeviceGrant(ctx, tx, p, "device:publish")
	if err != nil || !valid || g.Purpose != "runtime" {
		return false, err
	}
	changed, err := sqlc.New(tx).ConsumeRestoreApproval(ctx, p.GrantID)
	return changed == 1, err
}

func (s *Service) RevokeRuntimeGrant(ctx context.Context, tx pgx.Tx, user, machine, id string) (bool, error) {
	changed, err := sqlc.New(tx).RevokeBoundRuntimeGrant(ctx, sqlc.RevokeBoundRuntimeGrantParams{ID: id, UserID: user, MachineID: new(machine)})
	if err != nil || changed == 0 {
		return false, err
	}
	if err := sqlc.New(tx).RevokeGrantTokens(ctx, id); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) NotifyGrantRevoked(id string) {
	if s.grantRevoker != nil {
		s.grantRevoker(id)
	}
}
