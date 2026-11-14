package environment

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/jackc/pgx/v5"
)

type Budget struct {
	Environments int64 `json:"environments"`
}
type Quota struct {
	Limits    Budget `json:"limits"`
	Usage     Budget `json:"usage"`
	Remaining Budget `json:"remaining"`
}

func (s *Service) Quota(ctx context.Context, user, host string) (Quota, error) {
	var out Quota
	if !uuid.MatchString(user) || !uuid.MatchString(host) {
		return out, notFound
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	if _, err = q.ActiveUser(ctx, user); err != nil {
		return out, err
	}
	limit, err := quota(ctx, q, user, host)
	if err != nil {
		return out, err
	}
	used, err := q.UserHostUsage(ctx, sqlc.UserHostUsageParams{UserID: user, HostID: host})
	if err != nil {
		return out, err
	}
	out.Limits.Environments = int64(limit)
	out.Usage.Environments = used
	out.Remaining.Environments = max(0, int64(limit)-used)
	return out, tx.Commit(ctx)
}
