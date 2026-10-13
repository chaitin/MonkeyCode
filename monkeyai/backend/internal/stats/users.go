package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
)

// usersOverview returns a fixed rolling 24-hour summary and 90 UTC calendar days.
func (s *Service) usersOverview(w http.ResponseWriter, r *http.Request) {
	if len(r.URL.Query()) != 0 {
		resource.Fail(w, resource.Invalid("用户统计不支持查询参数"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollbackStats(ctx, tx, "users_overview")
	out, err := resource.DecodeObject(sqlc.New(tx).ReportingUsersOverview(ctx, s.now().UTC()))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	resource.JSON(w, http.StatusOK, out)
}
