package identity

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/jackc/pgx/v5"
)

var errAuthorizationCodeUsed = errors.New("授权码已被使用")
var errInvalidGrant = errors.New("授权族或刷新凭据不可用")

func (s *Service) redeemCodeAndStoreToken(ctx context.Context, code AuthorizationCode, accessHash, refreshHash string, accessExpiry, refreshExpiry time.Time) (sqlc.OauthGrant, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	defer func() {
		if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			slog.Error("回滚事务失败", "module", "identity", "operation", "redeemCodeAndStoreToken", "error", err)
		}
	}()
	q := sqlc.New(tx)
	result, err := q.RedeemAuthorizationCode(ctx, code.ID)
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	if result.RowsAffected() != 1 {
		return sqlc.OauthGrant{}, errAuthorizationCodeUsed
	}
	grant, err := q.CreateGrant(ctx, sqlc.CreateGrantParams{UserID: code.UserID, ClientID: code.ClientID, Scopes: code.Scopes, Audience: code.Audience, ExpiresAt: refreshExpiry})
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	_, err = q.CreateToken(ctx, sqlc.CreateTokenParams{UserID: code.UserID, ClientID: code.ClientID, GrantID: grant.ID,
		AccessTokenHash: accessHash, RefreshTokenHash: refreshHash, AccessExpiresAt: accessExpiry, RefreshExpiresAt: refreshExpiry})
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	return grant, tx.Commit(ctx)
}

func (s *Service) rotateToken(ctx context.Context, oldRefreshHash, clientID, accessHash, refreshHash string, accessExpiry, refreshExpiry time.Time) (sqlc.OauthGrant, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	defer func() {
		if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			slog.Error("回滚事务失败", "module", "identity", "operation", "rotateToken", "error", err)
		}
	}()
	q := sqlc.New(tx)
	params := sqlc.GetRefreshTokenParams{RefreshTokenHash: oldRefreshHash, ClientID: clientID}
	old, err := q.GetRefreshToken(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.OauthGrant{}, errInvalidGrant
	}
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	locked, err := q.LockGrant(ctx, old.GrantID)
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	if locked.RevokedAt != nil || !s.now().Before(locked.ExpiresAt) || locked.UserStatus != "active" || locked.UserDeletedAt != nil {
		return sqlc.OauthGrant{}, errInvalidGrant
	}
	// 获取族锁后重新读取，才能识别另一个刷新事务刚刚消费的旧凭据。
	old, err = q.GetRefreshToken(ctx, params)
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	if old.RotatedAt != nil {
		if err := revokeGrant(ctx, q, old.GrantID, "refresh_replay"); err != nil {
			return sqlc.OauthGrant{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return sqlc.OauthGrant{}, err
		}
		if s.grantRevoker != nil {
			s.grantRevoker(old.GrantID)
		}
		return sqlc.OauthGrant{}, errInvalidGrant
	}
	if old.RevokedAt != nil || !s.now().Before(old.RefreshExpiresAt) {
		return sqlc.OauthGrant{}, errInvalidGrant
	}
	changed, err := q.RotateToken(ctx, old.ID)
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	if changed != 1 {
		return sqlc.OauthGrant{}, errInvalidGrant
	}
	_, err = q.CreateToken(ctx, sqlc.CreateTokenParams{UserID: old.UserID, ClientID: clientID, GrantID: old.GrantID, ParentID: new(old.ID),
		AccessTokenHash: accessHash, RefreshTokenHash: refreshHash, AccessExpiresAt: accessExpiry, RefreshExpiresAt: refreshExpiry})
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	if err := q.ExtendGrant(ctx, sqlc.ExtendGrantParams{ID: old.GrantID, ExpiresAt: refreshExpiry}); err != nil {
		return sqlc.OauthGrant{}, err
	}
	grant, err := q.GetGrant(ctx, old.GrantID)
	if err != nil {
		return sqlc.OauthGrant{}, err
	}
	return grant, tx.Commit(ctx)
}

func revokeGrant(ctx context.Context, q *sqlc.Queries, id, reason string) error {
	if err := q.RevokeGrant(ctx, sqlc.RevokeGrantParams{ID: id, RevokeReason: new(reason)}); err != nil {
		return err
	}
	return q.RevokeGrantTokens(ctx, id)
}

func (s *Service) RevokeGrant(ctx context.Context, id, reason string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			slog.Error("回滚事务失败", "module", "identity", "operation", "RevokeGrant", "error", err)
		}
	}()
	q := sqlc.New(tx)
	if _, err := q.LockGrant(ctx, id); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	if err := revokeGrant(ctx, q, id, reason); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if s.grantRevoker != nil {
		s.grantRevoker(id)
	}
	return nil
}

func (s *Service) VerifyGrant(ctx context.Context, p Principal) (bool, error) {
	if p.Purpose == "runtime" {
		if allowed, err := s.runtimeAllowed(ctx, nil, p.UserID, p.MachineID); err != nil || !allowed {
			if err == nil {
				err = ErrRuntimeUnavailable
			}
			return false, err
		}
	}
	g, err := sqlc.New(s.db).GetGrant(ctx, p.GrantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if g.UserID != p.UserID || g.ClientID != p.ClientID || g.Audience != p.Audience || g.Purpose != p.Purpose || g.RevocationVersion != p.RevocationVersion {
		return false, nil
	}
	if p.MachineID != "" && (g.MachineID == nil || *g.MachineID != p.MachineID || g.KeyID == nil || *g.KeyID != p.KeyID) {
		return false, nil
	}
	for _, scope := range p.Scopes {
		if !slices.Contains(g.Scopes, scope) {
			return false, nil
		}
	}
	return true, nil
}
