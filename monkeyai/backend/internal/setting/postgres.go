package setting

import (
	"context"
	"encoding/json"
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

func (p *Postgres) CheckProxyRemoval(ctx context.Context, next json.RawMessage) error {
	var value struct {
		Proxies []outboundProxy `json:"proxies"`
	}
	if err := json.Unmarshal(next, &value); err != nil {
		return err
	}
	ids := map[string]bool{}
	for _, item := range value.Proxies {
		ids[item.ID] = true
	}
	previous, err := p.Get(ctx, "proxies")
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(previous.Value, &value); err != nil {
		return err
	}
	for _, item := range value.Proxies {
		if ids[item.ID] {
			continue
		}
		used, err := sqlc.New(database.Reader(ctx, p.pool)).ProxyInUse(ctx, item.ID)
		if err != nil {
			return err
		}
		if used {
			return fmt.Errorf("代理 %s 正被模型或连接器使用", item.Name)
		}
	}
	return nil
}

var ErrNotFound = errors.New("设置不存在")
