package identity

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"

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
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := sqlc.New(tx).CompleteAuthorizationRequest(ctx, request.ID)
	if err != nil || result.RowsAffected() != 1 {
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

func (s *Service) redeemCodeAndStoreToken(ctx context.Context, codeID, userID, clientID, accessHash, refreshHash string, accessExpiry, refreshExpiry time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := sqlc.New(tx).RedeemAuthorizationCode(ctx, codeID)
	if err != nil || result.RowsAffected() != 1 {
		return errors.New("授权码已被使用")
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
	defer func() { _ = tx.Rollback(ctx) }()

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

func (s *Service) insertUser(ctx context.Context, name, email, role, passwordHash string) (User, error) {
	var password *string
	if passwordHash != "" {
		password = new(passwordHash)
	}

	row, queryErr := sqlc.New(s.db).CreateUser(ctx, sqlc.CreateUserParams{Name: name, Email: email, Role: role, PasswordHash: password})
	return User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}, queryErr
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
	defer tx.Rollback(ctx)
	if s.accounts != nil {
		if err = s.accounts.PreserveAccounts(ctx, tx); err != nil {
			return User{}, err
		}
	}
	var disabledAt *time.Time
	if status == "disabled" {
		disabledAt = new(s.now())
	}
	row, err := sqlc.New(tx).UpdateUser(ctx, sqlc.UpdateUserParams{ID: id, Name: name, Role: role, Status: status, DisabledAt: disabledAt, PasswordHash: passwordHash})
	user := User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	return user, tx.Commit(ctx)
}

func (s *Service) upsertIdentity(ctx context.Context, profile upstreamProfile, adminOnly bool) (User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	identityRow, err := sqlc.New(tx).GetIdentityUser(ctx, sqlc.GetIdentityUserParams{Provider: profile.Provider, Issuer: profile.Issuer, ProviderSubject: profile.Subject})
	user := User{ID: identityRow.ID, Name: identityRow.Name, Email: identityRow.Email, AvatarURL: identityRow.AvatarUrl, Role: identityRow.Role, Status: identityRow.Status, JoinedAt: identityRow.JoinedAt, LastLoginAt: identityRow.LastLoginAt}
	if err == nil {
		if err := validateUpstreamUser(user, adminOnly); err != nil {
			return User{}, err
		}

		if profile.Provider == "baizhiyun" && profile.Email != "" {
			if err := sqlc.New(tx).UpdateBaizhiyunEmail(ctx, sqlc.UpdateBaizhiyunEmailParams{UserID: user.ID, Issuer: profile.Issuer, ProviderSubject: profile.Subject, Email: profile.Email}); err != nil {
				return User{}, err
			}
		}

		var record sqlc.UpdateIdentityUserRow
		record, err = sqlc.New(tx).UpdateIdentityUser(ctx, sqlc.UpdateIdentityUserParams{ID: user.ID, Name: profile.Name, AvatarUrl: profile.AvatarURL})

		if err != nil {
			return User{}, err
		}
		user.ID, user.Name, user.Email, user.AvatarURL, user.Role, user.Status, user.JoinedAt, user.LastLoginAt = record.ID, record.Name, record.Email, record.AvatarUrl, record.Role, record.Status, record.JoinedAt, record.LastLoginAt

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
	emailRow, err := sqlc.New(tx).GetUserByEmail(ctx, profile.Email)
	user = User{ID: emailRow.ID, Name: emailRow.Name, Email: emailRow.Email, AvatarURL: emailRow.AvatarUrl, Role: emailRow.Role, Status: emailRow.Status, JoinedAt: emailRow.JoinedAt, LastLoginAt: emailRow.LastLoginAt}
	switch {
	case err == nil:
		if err := validateUpstreamUser(user, adminOnly); err != nil {
			return User{}, err
		}
		var row sqlc.UpdateIdentityUserRow
		row, err = sqlc.New(tx).UpdateIdentityUser(ctx, sqlc.UpdateIdentityUserParams{ID: user.ID, Name: profile.Name, AvatarUrl: profile.AvatarURL})
		if err == nil {
			user.ID, user.Name, user.Email, user.AvatarURL, user.Role, user.Status, user.JoinedAt, user.LastLoginAt = row.ID, row.Name, row.Email, row.AvatarUrl, row.Role, row.Status, row.JoinedAt, row.LastLoginAt
		}
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
		var row sqlc.CreateIdentityUserRow
		row, err = sqlc.New(tx).CreateIdentityUser(ctx, sqlc.CreateIdentityUserParams{Name: profile.Name, Email: profile.Email, AvatarUrl: profile.AvatarURL})
		if err == nil {
			user.ID, user.Name, user.Email, user.AvatarURL, user.Role, user.Status, user.JoinedAt, user.LastLoginAt = row.ID, row.Name, row.Email, row.AvatarUrl, row.Role, row.Status, row.JoinedAt, row.LastLoginAt
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrUserDisabled
		}
		if err != nil {
			return User{}, err
		}
	case err != nil:
		return User{}, err
	}
	_, err = sqlc.New(tx).UpsertIdentity(ctx, sqlc.UpsertIdentityParams{
		UserID:            user.ID,
		Provider:          profile.Provider,
		Issuer:            profile.Issuer,
		ProviderSubject:   profile.Subject,
		ProviderUsername:  profile.Username,
		ProviderEmail:     profile.Email,
		ProviderAvatarUrl: profile.AvatarURL,
	})
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
	return nil
}

var (
	ErrNotFound             = errors.New("记录不存在")
	ErrUserDisabled         = errors.New("用户已停用")
	ErrRegistrationDisabled = errors.New("未开放新用户注册")
	ErrAdminRoleRequired    = errors.New("管理后台 OAuth 登录必须关联管理员")
)
