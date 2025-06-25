package store

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	esql "entgo.io/ent/dialect/sql"
)

type multiDriver struct {
	r, w   dialect.Driver
	logger *slog.Logger
}

func NewMultiDriver(r, w dialect.Driver, logger *slog.Logger) dialect.Driver {
	return &multiDriver{r: r, w: w, logger: logger}
}

var _ dialect.Driver = (*multiDriver)(nil)

func (d *multiDriver) Query(ctx context.Context, query string, args, v any) error {
	e := d.r
	if ent.QueryFromContext(ctx) == nil {
		e = d.w
	}
	if err := e.Query(ctx, query, args, v); err != nil {
		d.logger.Error("query error", "query", strings.ReplaceAll(query, `"`, ""), "args", args)
		return err
	}
	return nil
}

func (d *multiDriver) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	v := &esql.Rows{}
	err := d.r.Query(ctx, query, args, v)
	if err != nil {
		d.logger.Error("query error", "query", strings.ReplaceAll(query, `"`, ""), "args", args)
		return nil, err
	}
	return v.ColumnScanner.(*sql.Rows), nil
}

func (d *multiDriver) Exec(ctx context.Context, query string, args, v any) error {
	if err := d.w.Exec(ctx, query, args, v); err != nil {
		d.logger.Error("exec error", "query", strings.ReplaceAll(query, `"`, ""), "args", args)
		return err
	}
	return nil
}

func (d *multiDriver) Tx(ctx context.Context) (dialect.Tx, error) {
	return d.w.Tx(ctx)
}

func (d *multiDriver) BeginTx(ctx context.Context, opts *sql.TxOptions) (dialect.Tx, error) {
	return d.w.(interface {
		BeginTx(context.Context, *sql.TxOptions) (dialect.Tx, error)
	}).BeginTx(ctx, opts)
}

func (d *multiDriver) Close() error {
	rerr := d.r.Close()
	werr := d.w.Close()
	if rerr != nil {
		return rerr
	}
	if werr != nil {
		return werr
	}
	return nil
}

func (d *multiDriver) Dialect() string {
	return d.r.Dialect()
}
