package apikey

import (
	"context"
	"errors"
	"fmt"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey/sqlc"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

func (p *Postgres) Create(ctx context.Context, key Key, keyHash string) (Key, error) {
	record, err := sqlc.New(p.pool).CreateKey(ctx, sqlc.CreateKeyParams{
		UserID:    key.UserID,
		Name:      key.Name,
		KeyPrefix: key.Prefix,
		KeyHash:   keyHash,
		Scopes:    key.Scopes,
		ExpiresAt: key.ExpiresAt,
	})

	if err != nil {
		return Key{}, fmt.Errorf("保存调用密钥: %w", err)
	}
	key.ID, key.UserID, key.Name, key.Prefix, key.Scopes, key.ExpiresAt, key.LastUsedAt, key.CreatedAt, key.RevokedAt = record.ID, record.UserID, record.Name, record.KeyPrefix, record.Scopes, record.ExpiresAt, record.LastUsedAt, record.CreatedAt, record.RevokedAt

	return key, nil
}

func (p *Postgres) ListByUser(ctx context.Context, userID string) ([]Key, error) {
	return p.list(ctx, userID, false)
}

func (p *Postgres) List(ctx context.Context, userID string) ([]Key, error) {
	return p.list(ctx, userID, userID == "")
}

func (p *Postgres) list(ctx context.Context, userID string, all bool) ([]Key, error) {
	rows, err := sqlc.New(p.pool).ListKeys(ctx, sqlc.ListKeysParams{AllUsers: all, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("查询调用密钥: %w", err)
	}
	keys := make([]Key, 0, len(rows))
	for _, row := range rows {
		keys = append(keys, Key{ID: row.ID, UserID: row.UserID, UserName: row.UserName, Name: row.Name,
			Prefix: row.KeyPrefix, Scopes: row.Scopes, ExpiresAt: row.ExpiresAt, LastUsedAt: row.LastUsedAt, CreatedAt: row.CreatedAt, RevokedAt: row.RevokedAt})
	}
	return keys, nil
}

func (p *Postgres) Revoke(ctx context.Context, id, userID string) error {
	result, err := sqlc.New(p.pool).RevokeKey(ctx, sqlc.RevokeKeyParams{ID: id, UserID: userID})
	if err != nil {
		return fmt.Errorf("撤销调用密钥: %w", err)
	}
	if result != 1 {
		return ErrNotFound
	}
	return nil
}

func (p *Postgres) Authenticate(ctx context.Context, keyHash, scope string) (string, error) {
	var id, userID string
	record, err := sqlc.New(p.pool).AuthenticateKey(ctx, sqlc.AuthenticateKeyParams{KeyHash: keyHash, Scope: scope})
	if err == nil {
		id, userID = record.ID, record.UserID
	}

	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidKey
	}
	if err != nil {
		return "", fmt.Errorf("验证调用密钥: %w", err)
	}
	_, _ = sqlc.New(p.pool).TouchKey(ctx, id)
	return userID, nil
}
