package database

import (
	"context"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}
type snapshotKey struct{}

func WithSnapshot(ctx context.Context, tx pgx.Tx) context.Context {
	return context.WithValue(ctx, snapshotKey{}, tx)
}
func Reader(ctx context.Context, pool *pgxpool.Pool) Queryer {
	if tx, ok := ctx.Value(snapshotKey{}).(pgx.Tx); ok {
		return tx
	}
	return pool
}
