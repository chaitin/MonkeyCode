package endpoint

import (
	"context"
	"errors"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type View struct {
	MachineID string `json:"machine_id"`
	Profile
	Alias           *string `json:"alias"`
	DisplayName     string  `json:"display_name"`
	ProtocolVersion int32   `json:"protocol_version"`
	Online          bool    `json:"online"`
	LastSeenAt      *int64  `json:"last_seen_at"`
}

type Endpoint struct {
	View
	Status    string `json:"status"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	RevokedAt *int64 `json:"revoked_at"`
}

type Page struct {
	Items []Endpoint `json:"items"`
	Total int64      `json:"total"`
	Page  int        `json:"page"`
	Size  int        `json:"page_size"`
}

type Store interface {
	Active(context.Context, string) ([]Endpoint, error)
	Page(context.Context, string, int, int) (Page, error)
	Get(context.Context, string, string) (Endpoint, error)
	Register(context.Context, string, Hello, int) (Endpoint, error)
	Update(context.Context, string, string, string, *string, int) (Endpoint, error)
	Touch(context.Context, string, string, time.Time) error
}

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func millis(t *time.Time) *int64 {
	if t == nil {
		return nil
	}
	n := t.UnixMilli()
	return &n
}
func fromRow(row sqlc.Endpoint) Endpoint {
	name := row.DeviceName
	if row.Alias != nil {
		name = *row.Alias
	}
	return Endpoint{View: View{MachineID: row.MachineID, Profile: Profile{row.DeviceName, row.Platform, row.OsVersion, row.Arch, row.ClientVersion}, Alias: row.Alias, DisplayName: name, ProtocolVersion: row.ProtocolVersion, LastSeenAt: millis(row.LastSeenAt)}, Status: row.Status, CreatedAt: row.CreatedAt.UnixMilli(), UpdatedAt: row.UpdatedAt.UnixMilli(), RevokedAt: millis(row.RevokedAt)}
}
func missing(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return fault{"endpoint_not_found"}
	}
	return err
}

func (p *Postgres) Active(ctx context.Context, user string) ([]Endpoint, error) {
	rows, err := sqlc.New(p.pool).Active(ctx, user)
	out := make([]Endpoint, 0, len(rows))
	for _, row := range rows {
		out = append(out, fromRow(row))
	}
	return out, err
}
func (p *Postgres) Get(ctx context.Context, user, machine string) (Endpoint, error) {
	row, err := sqlc.New(p.pool).Get(ctx, sqlc.GetParams{UserID: user, MachineID: machine})
	return fromRow(row), missing(err)
}
func (p *Postgres) Page(ctx context.Context, user string, page, size int) (Page, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Page{}, err
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	total, err := q.Count(ctx, user)
	if err != nil {
		return Page{}, err
	}
	rows, err := q.Page(ctx, sqlc.PageParams{UserID: user, PageSize: int32(size), PageOffset: int32((page - 1) * size)})
	if err != nil {
		return Page{}, err
	}
	out := Page{Items: make([]Endpoint, 0, len(rows)), Total: total, Page: page, Size: size}
	for _, row := range rows {
		out.Items = append(out.Items, fromRow(row))
	}
	return out, tx.Commit(ctx)
}

func (p *Postgres) transaction(ctx context.Context, user string, fn func(*sqlc.Queries, pgx.Tx) (sqlc.Endpoint, error)) (Endpoint, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Endpoint{}, err
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	if _, err = q.LockUser(ctx, user); err != nil {
		return Endpoint{}, missing(err)
	}
	row, err := fn(q, tx)
	if err != nil {
		return Endpoint{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Endpoint{}, err
	}
	return fromRow(row), nil
}
func limit(ctx context.Context, q *sqlc.Queries, user string, max int) error {
	count, err := q.CountActive(ctx, user)
	if err != nil {
		return err
	}
	if count >= int64(max) {
		return fault{"endpoint_limit_exceeded"}
	}
	return nil
}
func (p *Postgres) Register(ctx context.Context, user string, h Hello, max int) (Endpoint, error) {
	return p.transaction(ctx, user, func(q *sqlc.Queries, tx pgx.Tx) (sqlc.Endpoint, error) {
		old, err := q.Get(ctx, sqlc.GetParams{UserID: user, MachineID: h.MachineID})
		fresh := errors.Is(err, pgx.ErrNoRows)
		if err != nil && !fresh {
			return old, err
		}
		if !fresh && old.Status == "revoked" {
			return old, fault{"endpoint_revoked"}
		}
		if fresh {
			if err = limit(ctx, q, user, max); err != nil {
				return old, err
			}
		}
		row, err := q.Register(ctx, sqlc.RegisterParams{UserID: user, MachineID: h.MachineID, DeviceName: h.Profile.DeviceName, Platform: h.Profile.Platform, OsVersion: h.Profile.OSVersion, Arch: h.Profile.Arch, ClientVersion: h.Profile.ClientVersion})
		if err != nil {
			return row, err
		}
		if fresh {
			err = audit.Write(ctx, tx, audit.Event{ActorID: user, Action: "endpoint.register", Category: "security", TargetType: "endpoint", TargetID: row.ID, Params: map[string]string{"machine_id": h.MachineID}})
		}
		return row, err
	})
}
func (p *Postgres) Update(ctx context.Context, user, machine, action string, alias *string, max int) (Endpoint, error) {
	return p.transaction(ctx, user, func(q *sqlc.Queries, tx pgx.Tx) (sqlc.Endpoint, error) {
		old, err := q.Get(ctx, sqlc.GetParams{UserID: user, MachineID: machine})
		if err != nil {
			return old, missing(err)
		}
		var row sqlc.Endpoint
		switch action {
		case "rename":
			if (alias == nil && old.Alias == nil) || (alias != nil && old.Alias != nil && *alias == *old.Alias) {
				return old, nil
			}
			row, err = q.Rename(ctx, sqlc.RenameParams{UserID: user, MachineID: machine, Alias: alias})
		case "revoke", "restore":
			status := "revoked"
			if action == "restore" {
				status = "active"
			}
			if old.Status == status {
				return old, nil
			}
			if status == "active" {
				if err = limit(ctx, q, user, max); err != nil {
					return old, err
				}
			}
			row, err = q.Status(ctx, sqlc.StatusParams{UserID: user, MachineID: machine, Status: status})
		default:
			return old, errInvalid
		}
		if err != nil {
			return row, err
		}
		err = audit.Write(ctx, tx, audit.Event{ActorID: user, Action: "endpoint." + action, Category: "security", TargetType: "endpoint", TargetID: row.ID, Params: map[string]string{"machine_id": machine}})
		return row, err
	})
}
func (p *Postgres) Touch(ctx context.Context, user, machine string, at time.Time) error {
	return sqlc.New(p.pool).Touch(ctx, sqlc.TouchParams{UserID: user, MachineID: machine, SeenAt: at})
}
