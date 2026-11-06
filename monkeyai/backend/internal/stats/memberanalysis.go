package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) memberAnalysis(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	var id pgtype.UUID
	if err := id.Scan(chi.URLParam(r, "id")); err != nil || !id.Valid || id.Bytes == [16]byte{} {
		resource.Fail(r.Context(), w, resource.Invalid("用户 ID 无效"))
		return
	}
	if len(r.URL.Query()) != 0 {
		resource.Fail(r.Context(), w, resource.Invalid("成员分析不支持查询参数"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	defer rollbackStats(ctx, tx, "member_analysis")
	out, err := resource.DecodeObject(sqlc.New(tx).ReportingMemberAnalysis(ctx, sqlc.ReportingMemberAnalysisParams{UserID: chi.URLParam(r, "id"), At: s.now().UTC()}))
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, http.StatusOK, out)
}
