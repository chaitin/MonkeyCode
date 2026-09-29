package identity

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"

	"github.com/jackc/pgx/v5"
)

func (s *Service) createAuthorizationRequest(ctx context.Context, request *AuthorizationRequest) error {
	row, queryErr := sqlc.New(s.db).CreateAuthorizationRequest(ctx, sqlc.CreateAuthorizationRequestParams{
		ClientID:            request.ClientID,
		RedirectUri:         request.RedirectURI,
		State:               request.State,
		CodeChallenge:       request.CodeChallenge,
		CodeChallengeMethod: request.CodeChallengeMethod,
		ExpiresAt:           request.ExpiresAt,
	})
	if queryErr != nil {
		return queryErr
	}
	request.ID = row
	return nil
}

func (s *Service) authorizationRequest(ctx context.Context, id string) (AuthorizationRequest, error) {
	var request AuthorizationRequest
	record, err := sqlc.New(s.db).GetAuthorizationRequest(ctx, id)
	if err == nil {
		request.ID, request.ClientID, request.RedirectURI, request.State, request.CodeChallenge, request.CodeChallengeMethod, request.ExpiresAt, request.CompletedAt = record.ID, record.ClientID, record.RedirectUri, record.State, record.CodeChallenge, record.CodeChallengeMethod, record.ExpiresAt, record.CompletedAt
	}

	if errors.Is(err, pgx.ErrNoRows) {
		return AuthorizationRequest{}, ErrNotFound
	}
	return request, err
}

func (s *Service) storeAuthorizationCode(ctx context.Context, request AuthorizationRequest, userID, codeHash string, expiresAt time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && ctx.Err() == nil {
			slog.ErrorContext(ctx, "回滚授权请求事务失败", "request_id", request.ID, "error", err)
		}
	}()

	result, err := sqlc.New(tx).CompleteAuthorizationRequest(ctx, request.ID)
	if err != nil {
		return fmt.Errorf("完成授权请求 %s: %w", request.ID, err)
	}
	if result.RowsAffected() != 1 {
		return errors.New("授权请求已完成或已过期")
	}
	_, err = sqlc.New(tx).CreateAuthorizationCode(ctx, sqlc.CreateAuthorizationCodeParams{
		CodeHash:               codeHash,
		AuthorizationRequestID: request.ID,
		UserID:                 userID,
		ClientID:               request.ClientID,
		RedirectUri:            request.RedirectURI,
		CodeChallenge:          request.CodeChallenge,
		ExpiresAt:              expiresAt,
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) authorizationCode(ctx context.Context, hash string) (AuthorizationCode, error) {
	var code AuthorizationCode
	record, err := sqlc.New(s.db).GetAuthorizationCode(ctx, hash)
	if err == nil {
		code.ID, code.UserID, code.ClientID, code.RedirectURI, code.CodeChallenge, code.ExpiresAt, code.RedeemedAt = record.ID, record.UserID, record.ClientID, record.RedirectUri, record.CodeChallenge, record.ExpiresAt, record.RedeemedAt
	}

	return code, err
}

var errAuthorizationCodeUsed = errors.New("授权码已被使用")

func (s *Service) redeemCodeAndStoreToken(ctx context.Context, codeID, userID, clientID, accessHash, refreshHash string, accessExpiry, refreshExpiry time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && ctx.Err() == nil {
			slog.ErrorContext(ctx, "回滚授权码事务失败", "code_id", codeID, "error", err)
		}
	}()

	result, err := sqlc.New(tx).RedeemAuthorizationCode(ctx, codeID)
	if err != nil {
		return fmt.Errorf("兑换授权码 %s: %w", codeID, err)
	}
	if result.RowsAffected() != 1 {
		return errAuthorizationCodeUsed
	}
	_, err = sqlc.New(tx).CreateToken(ctx, sqlc.CreateTokenParams{
		UserID:           userID,
		ClientID:         clientID,
		AccessTokenHash:  accessHash,
		RefreshTokenHash: refreshHash,
		AccessExpiresAt:  accessExpiry,
		RefreshExpiresAt: refreshExpiry,
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) rotateToken(ctx context.Context, oldRefreshHash, clientID, accessHash, refreshHash string, accessExpiry, refreshExpiry time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && ctx.Err() == nil {
			slog.ErrorContext(ctx, "回滚刷新令牌事务失败", "client_id", clientID, "error", err)
		}
	}()

	var userID string
	userID, err = sqlc.New(tx).RevokeRefreshToken(ctx, sqlc.RevokeRefreshTokenParams{RefreshTokenHash: oldRefreshHash, ClientID: clientID})

	if err != nil {
		return err
	}
	_, err = sqlc.New(tx).CreateToken(ctx, sqlc.CreateTokenParams{
		UserID:           userID,
		ClientID:         clientID,
		AccessTokenHash:  accessHash,
		RefreshTokenHash: refreshHash,
		AccessExpiresAt:  accessExpiry,
		RefreshExpiresAt: refreshExpiry,
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) createLoginState(ctx context.Context, stateHash, connectionID, requestID, purpose string, expiresAt time.Time) error {
	_, err := sqlc.New(s.db).CreateLoginState(ctx, sqlc.CreateLoginStateParams{
		StateHash:              stateHash,
		ConnectionID:           connectionID,
		AuthorizationRequestID: requestID,
		Purpose:                purpose,
		ExpiresAt:              expiresAt,
	})
	return err
}

func (s *Service) consumeLoginState(ctx context.Context, stateHash string) (LoginState, error) {
	var state LoginState
	record, err := sqlc.New(s.db).ConsumeLoginState(ctx, stateHash)
	if err == nil {
		state.ConnectionID, state.AuthorizationRequestID, state.Purpose = record.ConnectionID, record.AuthorizationRequestID, record.Purpose
	}

	return state, err
}

func (s *Service) createBrowserSession(ctx context.Context, userID, hash, authenticationMethod string, expiresAt time.Time) error {
	_, err := sqlc.New(s.db).CreateBrowserSession(ctx, sqlc.CreateBrowserSessionParams{TokenHash: hash, UserID: userID, AuthenticationMethod: authenticationMethod, ExpiresAt: expiresAt})
	return err
}

func (s *Service) userByBrowserToken(ctx context.Context, hash string) (User, string, error) {
	var user User
	var authenticationMethod string
	record, err := sqlc.New(s.db).GetBrowserUser(ctx, hash)
	if err == nil {
		user.ID, user.Name, user.Email, user.AvatarURL, user.Role, user.Status, user.JoinedAt, user.LastLoginAt, authenticationMethod = record.ID, record.Name, record.Email, record.AvatarUrl, record.Role, record.Status, record.JoinedAt, record.LastLoginAt, record.AuthenticationMethod
	}

	return user, authenticationMethod, err
}

func (s *Service) userByAccessToken(ctx context.Context, hash string) (User, error) {
	row, queryErr := sqlc.New(s.db).GetTokenUser(ctx, hash)
	return User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}, queryErr
}

func (s *Service) revokeBrowserSession(ctx context.Context, hash string) error {
	_, err := sqlc.New(s.db).RevokeBrowserSession(ctx, hash)
	return err
}

func (s *Service) revokeToken(ctx context.Context, hash, clientID string) error {
	_, err := sqlc.New(s.db).RevokeToken(ctx, sqlc.RevokeTokenParams{AccessTokenHash: hash, ClientID: clientID})
	return err
}

func (s *Service) listUsers(ctx context.Context) ([]User, error) {
	rows, err := sqlc.New(s.db).ListUsers(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]User, 0)
	for _, row := range rows {
		user := User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}
		users = append(users, user)
	}
	return users, nil
}

func (s *Service) userByID(ctx context.Context, id string) (User, error) {
	row, queryErr := sqlc.New(s.db).GetUser(ctx, id)
	return User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}, queryErr
}

func (s *Service) updateUser(ctx context.Context, id, name, role, status, passwordHash string) (User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && ctx.Err() == nil {
			slog.ErrorContext(ctx, "回滚更新用户事务失败", "user_id", id, "error", err)
		}
	}()
	if s.accounts != nil {
		if err = s.accounts.PreserveAccounts(ctx, tx); err != nil {
			return User{}, err
		}
	}
	result, err := s.writer.UpdateUser(ctx, tx, member.UpdateUser{ID: id, Name: name, Role: role, Status: status, PasswordHash: passwordHash})
	user := userFromMember(result)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, tx.Commit(ctx)
}

func (s *Service) upsertIdentity(ctx context.Context, profile upstreamProfile, adminOnly, autoRegistrationEnabled bool) (User, error) {
	result, err := s.writer.UpsertIdentity(ctx, member.OAuthIdentity{
		Provider: profile.Provider, Issuer: profile.Issuer, Subject: profile.Subject,
		Username: profile.Username, Name: profile.Name, Email: profile.Email, AvatarURL: profile.AvatarURL,
		AdminOnly: adminOnly, AutoRegistrationEnabled: autoRegistrationEnabled,
	})
	return userFromMember(result), err
}

func validateUpstreamUser(user User, adminOnly bool) error {
	if user.Status != "active" {
		return ErrUserDisabled
	}
	if adminOnly && user.Role != "admin" {
		return ErrAdminRoleRequired
	}
	return nil
}

var (
	ErrNotFound             = errors.New("记录不存在")
	ErrUserDisabled         = errors.New("用户已停用")
	ErrRegistrationDisabled = errors.New("未开放新用户注册")
	ErrAdminRoleRequired    = errors.New("管理后台 OAuth 登录必须关联管理员")
)
