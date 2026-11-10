package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
)

// sessionOverview reads every panel from one snapshot and one server timestamp.
func (s *Service) sessionOverview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if r.URL.RawQuery != "" {
		resource.Fail(r.Context(), w, resource.Invalid("会话分析不支持查询参数"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	defer rollbackStats(ctx, tx, "session_overview")
	out, err := resource.DecodeObject(sqlc.New(tx).ReportingSessionOverview(ctx, s.now().UTC()))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, http.StatusOK, out)
}
