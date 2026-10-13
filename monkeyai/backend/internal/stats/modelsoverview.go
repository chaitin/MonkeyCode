package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) modelsOverview(w http.ResponseWriter, r *http.Request) {
	if len(r.URL.Query()) != 0 {
		resource.Fail(w, resource.Invalid("模型总览不支持查询参数"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollbackStats(ctx, tx, "models_overview")
	out, err := resource.DecodeObject(sqlc.New(tx).ReportingModelsOverview(ctx, s.now().UTC()))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	resource.JSON(w, http.StatusOK, out)
}
