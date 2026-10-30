package environment

import (
	"context"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/jackc/pgx/v5"
)

type Budget struct {
	Environments int64 `json:"environments"`
	Running      int64 `json:"running"`
	CPUMillis    int64 `json:"cpu_millis"`
	MemoryBytes  int64 `json:"memory_bytes"`
	StorageBytes int64 `json:"storage_bytes"`
}

type Quota struct {
	Limits    Budget `json:"limits"`
	Usage     Budget `json:"usage"`
	Remaining Budget `json:"remaining"`
}

func (s *Service) Quota(ctx context.Context, user string) (Quota, error) {
	var out Quota
	if !uuid.MatchString(user) {
		return out, notFound
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	if _, err := q.ActiveUser(ctx, user); err != nil {
		return out, err
	}
	limits, err := quota(ctx, q, user)
	if err != nil {
		return out, err
	}
	usage, err := q.UserUsage(ctx, user)
	if err != nil {
		return out, err
	}
	out.Limits = Budget{int64(limits.MaxEnvironments), int64(limits.MaxRunning), limits.CpuMillis, limits.MemoryBytes, limits.StorageBytes}
	out.Usage = Budget{usage.Environments, usage.Running, usage.CpuMillis, usage.MemoryBytes, usage.StorageBytes}
	out.Remaining = Budget{
		Environments: max(0, out.Limits.Environments-out.Usage.Environments),
		Running:      max(0, out.Limits.Running-out.Usage.Running),
		CPUMillis:    max(0, out.Limits.CPUMillis-out.Usage.CPUMillis),
		MemoryBytes:  max(0, out.Limits.MemoryBytes-out.Usage.MemoryBytes),
		StorageBytes: max(0, out.Limits.StorageBytes-out.Usage.StorageBytes),
	}
	return out, tx.Commit(ctx)
}

func (s *Service) ownQuota(w http.ResponseWriter, r *http.Request) {
	out, err := s.Quota(r.Context(), *owner(r, false))
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, http.StatusOK, out)
}
