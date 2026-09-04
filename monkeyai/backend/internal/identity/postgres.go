package identity

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Service) createAuthorizationRequest(ctx context.Context, request *AuthorizationRequest) error {
	return s.db.QueryRow(ctx, `
		INSERT INTO oauth_authorization_requests (
			client_id, redirect_uri, state, code_challenge, code_challenge_method, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, request.ClientID, request.RedirectURI, request.State, request.CodeChallenge, request.CodeChallengeMethod, request.ExpiresAt).Scan(&request.ID)
}

func (s *Service) authorizationRequest(ctx context.Context, id string) (AuthorizationRequest, error) {
	var request AuthorizationRequest
	err := s.db.QueryRow(ctx, `
		SELECT id, client_id, redirect_uri, state, code_challenge,
			code_challenge_method, expires_at, completed_at
		FROM oauth_authorization_requests
		WHERE id = $1
	`, id).Scan(
		&request.ID, &request.ClientID, &request.RedirectURI, &request.State,
		&request.CodeChallenge, &request.CodeChallengeMethod, &request.ExpiresAt,
		&request.CompletedAt,
	)
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
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `
		UPDATE oauth_authorization_requests
		SET completed_at = now()
		WHERE id = $1 AND completed_at IS NULL AND expires_at > now()
	`, request.ID)
	if err != nil || result.RowsAffected() != 1 {
		return errors.New("授权请求已完成或已过期")
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO oauth_authorization_codes (
			code_hash, authorization_request_id, user_id, client_id,
			redirect_uri, code_challenge, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, codeHash, request.ID, userID, request.ClientID, request.RedirectURI, request.CodeChallenge, expiresAt)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) authorizationCode(ctx context.Context, hash string) (AuthorizationCode, error) {
	var code AuthorizationCode
	err := s.db.QueryRow(ctx, `
		SELECT id, user_id, client_id, redirect_uri, code_challenge, expires_at, redeemed_at
		FROM oauth_authorization_codes
		WHERE code_hash = $1
	`, hash).Scan(&code.ID, &code.UserID, &code.ClientID, &code.RedirectURI, &code.CodeChallenge, &code.ExpiresAt, &code.RedeemedAt)
	return code, err
}

func (s *Service) redeemCodeAndStoreToken(ctx context.Context, codeID, userID, clientID, accessHash, refreshHash string, accessExpiry, refreshExpiry time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `
		UPDATE oauth_authorization_codes
		SET redeemed_at = now()
		WHERE id = $1 AND redeemed_at IS NULL AND expires_at > now()
	`, codeID)
	if err != nil || result.RowsAffected() != 1 {
		return errors.New("授权码已被使用")
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO oauth_tokens (
			user_id, client_id, access_token_hash, refresh_token_hash,
			access_expires_at, refresh_expires_at
		) VALUES ($1, $2, $3, $4, $5, $6)
	`, userID, clientID, accessHash, refreshHash, accessExpiry, refreshExpiry)
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
	defer func() { _ = tx.Rollback(ctx) }()

	var userID string
	err = tx.QueryRow(ctx, `
		UPDATE oauth_tokens
		SET revoked_at = now()
		WHERE refresh_token_hash = $1 AND client_id = $2
			AND revoked_at IS NULL AND refresh_expires_at > now()
		RETURNING user_id
	`, oldRefreshHash, clientID).Scan(&userID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO oauth_tokens (
			user_id, client_id, access_token_hash, refresh_token_hash,
			access_expires_at, refresh_expires_at
		) VALUES ($1, $2, $3, $4, $5, $6)
	`, userID, clientID, accessHash, refreshHash, accessExpiry, refreshExpiry)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) createLoginState(ctx context.Context, stateHash, connectionID, requestID, purpose string, expiresAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO oauth_login_states (
			state_hash, connection_id, authorization_request_id, purpose, expires_at
		) VALUES ($1, $2, nullif($3, '')::uuid, $4, $5)
	`, stateHash, connectionID, requestID, purpose, expiresAt)
	return err
}

func (s *Service) consumeLoginState(ctx context.Context, stateHash string) (LoginState, error) {
	var state LoginState
	err := s.db.QueryRow(ctx, `
		UPDATE oauth_login_states
		SET consumed_at = now()
		WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
		RETURNING connection_id, coalesce(authorization_request_id::text, ''), purpose
	`, stateHash).Scan(&state.ConnectionID, &state.AuthorizationRequestID, &state.Purpose)
	return state, err
}

func (s *Service) createBrowserSession(ctx context.Context, userID, hash, authenticationMethod string, expiresAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO browser_sessions (token_hash, user_id, authentication_method, expires_at)
		VALUES ($1, $2, $3, $4)
	`, hash, userID, authenticationMethod, expiresAt)
	return err
}

func (s *Service) userByBrowserToken(ctx context.Context, hash string) (User, string, error) {
	var user User
	var authenticationMethod string
	err := s.db.QueryRow(ctx, `
		SELECT u.id, u.name, u.email, coalesce(u.avatar_url, ''), u.role,
			u.status, u.joined_at, u.last_login_at, s.authentication_method
		FROM browser_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
			AND u.status = 'active' AND u.deleted_at IS NULL
	`, hash).Scan(
		&user.ID, &user.Name, &user.Email, &user.AvatarURL, &user.Role,
		&user.Status, &user.JoinedAt, &user.LastLoginAt, &authenticationMethod,
	)
	return user, authenticationMethod, err
}

func (s *Service) userByAccessToken(ctx context.Context, hash string) (User, error) {
	return scanUser(s.db.QueryRow(ctx, `
		SELECT u.id, u.name, u.email, coalesce(u.avatar_url, ''), u.role,
			u.status, u.joined_at, u.last_login_at
		FROM oauth_tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.access_token_hash = $1 AND t.revoked_at IS NULL
			AND t.access_expires_at > now() AND u.status = 'active' AND u.deleted_at IS NULL
	`, hash))
}

func (s *Service) revokeBrowserSession(ctx context.Context, hash string) error {
	_, err := s.db.Exec(ctx, `UPDATE browser_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, hash)
	return err
}

func (s *Service) revokeToken(ctx context.Context, hash, clientID string) error {
	_, err := s.db.Exec(ctx, `
		UPDATE oauth_tokens SET revoked_at = now()
		WHERE client_id = $2 AND revoked_at IS NULL
			AND (access_token_hash = $1 OR refresh_token_hash = $1)
	`, hash, clientID)
	return err
}

func (s *Service) listUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
		FROM users WHERE deleted_at IS NULL ORDER BY joined_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]User, 0)
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Service) insertUser(ctx context.Context, name, email, role, passwordHash string) (User, error) {
	var password any
	if passwordHash != "" {
		password = passwordHash
	}
	return scanUser(s.db.QueryRow(ctx, `
		INSERT INTO users (name, email, role, password_hash)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
	`, name, email, role, password))
}

func (s *Service) userByID(ctx context.Context, id string) (User, error) {
	return scanUser(s.db.QueryRow(ctx, `
		SELECT id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
		FROM users WHERE id = $1 AND deleted_at IS NULL
	`, id))
}

func (s *Service) updateUser(ctx context.Context, id, name, role, status, passwordHash string) (User, error) {
	var disabledAt any
	if status == "disabled" {
		disabledAt = s.now()
	}
	user, err := scanUser(s.db.QueryRow(ctx, `
		UPDATE users SET name = $2, role = $3, status = $4, disabled_at = $5,
			password_hash = CASE WHEN $6 = '' THEN password_hash ELSE $6 END,
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
	`, id, name, role, status, disabledAt, passwordHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

type rowScanner interface {
	Scan(...any) error
}

func scanUser(row rowScanner) (User, error) {
	var user User
	if err := row.Scan(&user.ID, &user.Name, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.JoinedAt, &user.LastLoginAt); err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Service) upsertIdentity(ctx context.Context, profile upstreamProfile, adminOnly bool) (User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	user, err := scanUser(tx.QueryRow(ctx, `
		SELECT u.id, u.name, u.email, coalesce(u.avatar_url, ''), u.role, u.status, u.joined_at, u.last_login_at
		FROM user_identities i JOIN users u ON u.id = i.user_id
		WHERE i.provider = $1 AND i.issuer = $2 AND i.provider_subject = $3
			AND i.deleted_at IS NULL AND u.deleted_at IS NULL
	`, profile.Provider, profile.Issuer, profile.Subject))
	if err == nil {
		if err := validateUpstreamUser(user, adminOnly); err != nil {
			return User{}, err
		}
		err = tx.QueryRow(ctx, `
			UPDATE users SET name = $2, avatar_url = nullif($3, ''), last_login_at = now(), updated_at = now()
			WHERE id = $1
			RETURNING id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
		`, user.ID, profile.Name, profile.AvatarURL).Scan(&user.ID, &user.Name, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.JoinedAt, &user.LastLoginAt)
		if err != nil {
			return User{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return User{}, err
		}
		return user, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return User{}, err
	}

	if profile.Email == "" {
		if adminOnly {
			return User{}, ErrAdminRoleRequired
		}
		profile.Email = fmt.Sprintf("%s@%s.oauth.local", profile.Subject, profile.Provider)
	}
	if profile.Name == "" {
		profile.Name = profile.Username
	}
	if profile.Name == "" {
		profile.Name = profile.Email
	}
	user, err = scanUser(tx.QueryRow(ctx, `
		SELECT id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
		FROM users
		WHERE lower(email) = lower($1) AND deleted_at IS NULL
	`, profile.Email))
	switch {
	case err == nil:
		if err := validateUpstreamUser(user, adminOnly); err != nil {
			return User{}, err
		}
		err = tx.QueryRow(ctx, `
			UPDATE users SET name = $2, avatar_url = nullif($3, ''), last_login_at = now(), updated_at = now()
			WHERE id = $1
			RETURNING id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
		`, user.ID, profile.Name, profile.AvatarURL).Scan(&user.ID, &user.Name, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.JoinedAt, &user.LastLoginAt)
		if err != nil {
			return User{}, err
		}
	case errors.Is(err, pgx.ErrNoRows):
		if adminOnly {
			return User{}, ErrAdminRoleRequired
		}
		if !s.registrationEnabled(ctx) {
			return User{}, ErrRegistrationDisabled
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO users (name, email, avatar_url, role, last_login_at)
			VALUES ($1, $2, nullif($3, ''), 'user', now())
			ON CONFLICT (lower(email)) WHERE deleted_at IS NULL DO UPDATE SET
				name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url,
				last_login_at = now(), updated_at = now()
			WHERE users.role = 'user' AND users.status = 'active'
			RETURNING id, name, email, coalesce(avatar_url, ''), role, status, joined_at, last_login_at
		`, profile.Name, profile.Email, profile.AvatarURL).Scan(&user.ID, &user.Name, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.JoinedAt, &user.LastLoginAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrAdminPasswordRequired
		}
		if err != nil {
			return User{}, err
		}
	case err != nil:
		return User{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO user_identities (user_id, provider, issuer, provider_subject, username, email, avatar_url)
		VALUES ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), nullif($7, ''))
	`, user.ID, profile.Provider, profile.Issuer, profile.Subject, profile.Username, profile.Email, profile.AvatarURL)
	if err != nil {
		return User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return user, nil
}

func validateUpstreamUser(user User, adminOnly bool) error {
	if user.Status != "active" {
		return ErrUserDisabled
	}
	if adminOnly && user.Role != "admin" {
		return ErrAdminRoleRequired
	}
	if !adminOnly && user.Role == "admin" {
		return ErrAdminPasswordRequired
	}
	return nil
}

var (
	ErrNotFound              = errors.New("记录不存在")
	ErrUserDisabled          = errors.New("用户已停用")
	ErrRegistrationDisabled  = errors.New("未开放新用户注册")
	ErrAdminPasswordRequired = errors.New("管理员必须使用密码登录")
	ErrAdminRoleRequired     = errors.New("管理后台 OAuth 登录必须关联管理员")
)
