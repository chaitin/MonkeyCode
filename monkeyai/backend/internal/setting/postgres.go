package setting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

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
	record, err := scanRecord(p.pool.QueryRow(ctx, `
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
	rows, err := p.pool.Query(ctx, `
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
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Record{}, fmt.Errorf("开始保存设置: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	stored, err := scanRecord(tx.QueryRow(ctx, `
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
	payload, err := json.Marshal(Event{Key: stored.Key, Version: stored.UpdatedAt.UnixMilli()})
	if err != nil {
		return Record{}, err
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify('monkeyai_settings', $1)`, string(payload)); err != nil {
		return Record{}, fmt.Errorf("发布设置变更: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Record{}, fmt.Errorf("提交设置: %w", err)
	}
	return stored, nil
}

func (p *Postgres) Listen(ctx context.Context, publish func(Event)) error {
	connection, err := p.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("获取设置监听连接: %w", err)
	}
	defer connection.Release()
	if _, err := connection.Exec(ctx, `LISTEN monkeyai_settings`); err != nil {
		return fmt.Errorf("监听设置变更: %w", err)
	}
	for {
		notification, err := connection.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var event Event
		if json.Unmarshal([]byte(notification.Payload), &event) == nil && event.Key != "" {
			publish(event)
		}
	}
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
