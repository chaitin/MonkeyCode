package setting

import (
	"context"
	"errors"
	"fmt"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting/sqlc"

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
	row, err := sqlc.New(database.Reader(ctx, p.pool)).GetSetting(ctx, key)
	record := Record{Key: row.Key, Value: row.Value, SchemaVersion: int(row.SchemaVersion), UpdatedByUserID: row.UpdatedByUserID, UpdatedAt: row.UpdatedAt}
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return record, err
}

func (p *Postgres) List(ctx context.Context) ([]Record, error) {
	rows, err := sqlc.New(database.Reader(ctx, p.pool)).ListSettings(ctx)
	if err != nil {
		return nil, fmt.Errorf("查询设置: %w", err)
	}

	records := make([]Record, 0, len(Keys))
	for _, row := range rows {
		record := Record{Key: row.Key, Value: row.Value, SchemaVersion: int(row.SchemaVersion), UpdatedByUserID: row.UpdatedByUserID, UpdatedAt: row.UpdatedAt}
		records = append(records, record)
	}
	return records, nil
}

func (p *Postgres) Put(ctx context.Context, record Record) (Record, error) {
	row, err := sqlc.New(database.Reader(ctx, p.pool)).PutSetting(ctx, sqlc.PutSettingParams{
		Key:             record.Key,
		Value:           record.Value,
		SchemaVersion:   int32(record.SchemaVersion),
		UpdatedByUserID: record.UpdatedByUserID,
	})
	stored := Record{Key: row.Key, Value: row.Value, SchemaVersion: int(row.SchemaVersion), UpdatedByUserID: row.UpdatedByUserID, UpdatedAt: row.UpdatedAt}
	if err != nil {
		return Record{}, fmt.Errorf("保存设置: %w", err)
	}
	return stored, nil
}

var ErrNotFound = errors.New("设置不存在")
