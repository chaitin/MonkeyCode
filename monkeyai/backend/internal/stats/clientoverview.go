package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) reportingClientsOverview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	for _, name := range []string{"cursor", "limit", "page", "page_size"} {
		if r.URL.Query().Has(name) {
			resource.Fail(w, resource.Invalid("客户端分布概览不支持分页参数"))
			return
		}
	}
	s.reportingRead(false, func(ctx context.Context, tx pgx.Tx, f reportingFilter) (resource.Object, error) {
		out, err := resource.DecodeObject(sqlc.New(tx).ReportingClientsOverview(ctx, f.sqlParams(reportCursor{}, "")))
		if err != nil {
			return nil, err
		}
		out["data_freshness_seconds"] = nil
		if received, ok := out["last_received_at"].(string); ok {
			if at, err := time.Parse(time.RFC3339Nano, received); err == nil {
				out["data_freshness_seconds"] = max(0, s.now().Sub(at).Seconds())
			}
		}
		delete(out, "last_received_at")
		return out, nil
	})(w, r)
}
