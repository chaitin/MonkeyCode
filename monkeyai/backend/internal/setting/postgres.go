package setting

import (
	"context"
	"errors"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

func (p *Postgres) Get(ctx context.Context, key string) (Record, error) {
	record, err := scanRecord(database.Reader(ctx, p.pool).QueryRow(ctx, `
		SELECT key, value, schema_version, updated_by_user_id, updated_at
		FROM settings
		WHERE key = $1
	`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return record, err
}

func (p *Postgres) List(ctx context.Context) ([]Record, error) {
	rows, err := database.Reader(ctx, p.pool).Query(ctx, `
		SELECT key, value, schema_version, updated_by_user_id, updated_at
		FROM settings
		ORDER BY key
	`)
	if err != nil {
		return nil, fmt.Errorf("查询设置: %w", err)
	}
	defer rows.Close()

	records := make([]Record, 0, len(Keys))
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (p *Postgres) Put(ctx context.Context, record Record) (Record, error) {
	stored, err := scanRecord(database.Reader(ctx, p.pool).QueryRow(ctx, `
		INSERT INTO settings (key, value, schema_version, updated_by_user_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (key) DO UPDATE SET
			value = EXCLUDED.value,
			schema_version = EXCLUDED.schema_version,
			updated_by_user_id = EXCLUDED.updated_by_user_id,
			updated_at = now()
		RETURNING key, value, schema_version, updated_by_user_id, updated_at
	`, record.Key, record.Value, record.SchemaVersion, record.UpdatedByUserID))
	if err != nil {
		return Record{}, fmt.Errorf("保存设置: %w", err)
	}
	return stored, nil
}

type scanner interface {
	Scan(...any) error
}

func scanRecord(row scanner) (Record, error) {
	var record Record
	if err := row.Scan(
		&record.Key,
		&record.Value,
		&record.SchemaVersion,
		&record.UpdatedByUserID,
		&record.UpdatedAt,
	); err != nil {
		return Record{}, err
	}
	return record, nil
}

var ErrNotFound = errors.New("设置不存在")
