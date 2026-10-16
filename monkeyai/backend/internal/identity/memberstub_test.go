package identity

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 成员实现由私有模块注入，认证集成测试只提供数据库写入替身。
func newTestService(pool *pgxpool.Pool, settings SettingReader, publicURL string) *Service {
	return NewService(pool, settings, publicURL).WithUserWriter(testUserWriter{pool: pool})
}

type testUserWriter struct {
	member.EmptyUserWriter
	pool *pgxpool.Pool
}

const testUserColumns = "id,name,email,coalesce(avatar_url,''),role,status,joined_at,last_login_at"

func readTestUser(row pgx.Row) (member.User, error) {
	var user member.User
	err := row.Scan(&user.ID, &user.Name, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.JoinedAt, &user.LastLoginAt)
	return user, err
}

func (w testUserWriter) TouchLogin(ctx context.Context, id string) error {
	_, err := sqlc.New(w.pool).TouchLogin(ctx, id)
	return err
}

func (w testUserWriter) UpdateUser(ctx context.Context, tx pgx.Tx, in member.UpdateUser) (member.User, error) {
	var disabled *time.Time
	if in.Status == "disabled" {
		disabled = new(time.Now())
	}
	return readTestUser(tx.QueryRow(ctx, `UPDATE users SET name=$2,role=$3,status=$4,disabled_at=$5,
		password_hash=CASE WHEN $6='' THEN password_hash ELSE $6 END,updated_at=now()
		WHERE id=$1 AND deleted_at IS NULL RETURNING `+testUserColumns,
		in.ID, in.Name, in.Role, in.Status, disabled, in.PasswordHash))
}

func (w testUserWriter) RegisterEmailUser(ctx context.Context, tx pgx.Tx, email string) (member.User, error) {
	if err := sqlc.New(tx).CreateEmailUser(ctx, sqlc.CreateEmailUserParams{Name: email, Email: email}); err != nil {
		return member.User{}, err
	}
	return readTestUser(tx.QueryRow(ctx, "SELECT "+testUserColumns+" FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL", email))
}

func (w testUserWriter) ResetPassword(ctx context.Context, tx pgx.Tx, in member.PasswordReset) (string, error) {
	return sqlc.New(tx).ResetPassword(ctx, sqlc.ResetPasswordParams{Email: in.Email, PasswordHash: new(in.PasswordHash)})
}

func (w testUserWriter) ResetUserPassword(ctx context.Context, tx pgx.Tx, id, hash string) error {
	_, err := sqlc.New(tx).ResetUserPassword(ctx, sqlc.ResetUserPasswordParams{ID: id, PasswordHash: new(hash)})
	return err
}

func (w testUserWriter) CreateUser(ctx context.Context, in member.CreateUser) (member.User, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return member.User{}, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	if err := q.LockUserCreationGroups(ctx); err != nil {
		return member.User{}, err
	}
	groups, err := normalizeCreationGroups(in.GroupIDs)
	if err != nil {
		return member.User{}, member.ErrGroupUnavailable
	}
	if len(groups) > 0 {
		found, err := q.GetUserCreationGroups(ctx, groups)
		if err != nil {
			return member.User{}, err
		}
		if len(found) != len(groups) {
			return member.User{}, member.ErrGroupUnavailable
		}
	}
	var hash *string
	if in.Password != "" {
		value, err := hashPassword(in.Password)
		if err != nil {
			return member.User{}, err
		}
		hash = new(value)
	}
	user, err := readTestUser(tx.QueryRow(ctx, `INSERT INTO users(name,email,role,password_hash) VALUES($1,$2,$3,$4) RETURNING `+testUserColumns, in.Name, in.Email, in.Role, hash))
	if err != nil {
		return member.User{}, err
	}
	if len(groups) > 0 {
		if err := q.AssignCreatedUserGroups(ctx, sqlc.AssignCreatedUserGroupsParams{GroupIds: groups, UserID: user.ID, ActorID: in.ActorID}); err != nil {
			return member.User{}, err
		}
		if err := q.TouchUserCreationGroups(ctx, groups); err != nil {
			return member.User{}, err
		}
	}
	return user, tx.Commit(ctx)
}

func (w testUserWriter) UpsertIdentity(ctx context.Context, in member.OAuthIdentity) (member.User, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return member.User{}, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	row, err := q.GetIdentityUser(ctx, sqlc.GetIdentityUserParams{Provider: in.Provider, Issuer: in.Issuer, ProviderSubject: in.Subject})
	var user member.User
	bound := err == nil
	if bound {
		user = member.User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}
	} else {
		if !errors.Is(err, pgx.ErrNoRows) {
			return member.User{}, err
		}
		if in.Email == "" {
			if in.AdminOnly {
				return member.User{}, ErrAdminRoleRequired
			}
			in.Email = fmt.Sprintf("%s@%s.oauth.local", in.Subject, in.Provider)
		}
		user, err = readTestUser(tx.QueryRow(ctx, "SELECT "+testUserColumns+" FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL", in.Email))
	}
	if in.Name == "" {
		in.Name = in.Username
	}
	if in.Name == "" {
		in.Name = in.Email
	}
	switch {
	case err == nil:
		if err := validateUpstreamUser(userFromMember(user), in.AdminOnly); err != nil {
			return member.User{}, err
		}
		if bound && in.Provider == "baizhiyun" && in.Email != "" {
			if err := q.UpdateBaizhiyunEmail(ctx, sqlc.UpdateBaizhiyunEmailParams{UserID: user.ID, Issuer: in.Issuer, ProviderSubject: in.Subject, Email: in.Email}); err != nil {
				return member.User{}, err
			}
		}
		user, err = readTestUser(tx.QueryRow(ctx, "UPDATE users SET name=$2,avatar_url=NULLIF($3,''),last_login_at=now(),updated_at=now() WHERE id=$1 RETURNING "+testUserColumns, user.ID, in.Name, in.AvatarURL))
	case errors.Is(err, pgx.ErrNoRows):
		if in.AdminOnly {
			return member.User{}, ErrAdminRoleRequired
		}
		if !in.AutoRegistrationEnabled {
			return member.User{}, ErrRegistrationDisabled
		}
		created, createErr := q.CreateIdentityUser(ctx, sqlc.CreateIdentityUserParams{Name: in.Name, Email: in.Email, AvatarUrl: in.AvatarURL})
		if errors.Is(createErr, pgx.ErrNoRows) {
			return member.User{}, ErrUserDisabled
		}
		if createErr != nil {
			return member.User{}, createErr
		}
		user = member.User{ID: created.ID, Name: created.Name, Email: created.Email, AvatarURL: created.AvatarUrl, Role: created.Role, Status: created.Status, JoinedAt: created.JoinedAt, LastLoginAt: created.LastLoginAt}
		err = nil
	default:
		return member.User{}, err
	}
	if err != nil {
		return member.User{}, err
	}
	if !bound {
		_, err = q.UpsertIdentity(ctx, sqlc.UpsertIdentityParams{UserID: user.ID, Provider: in.Provider, Issuer: in.Issuer, ProviderSubject: in.Subject, ProviderUsername: in.Username, ProviderEmail: in.Email, ProviderAvatarUrl: in.AvatarURL})
		if err != nil {
			return member.User{}, err
		}
	}
	return user, tx.Commit(ctx)
}
