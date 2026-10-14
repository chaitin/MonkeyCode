package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
)

func (s *Service) reportingOverview(w http.ResponseWriter, r *http.Request) {
	s.reportingRead(false, func(ctx context.Context, tx pgx.Tx, f reportingFilter) (resource.Object, error) {
		if f.cursor != "" {
			return nil, unexpectedCursor()
		}
		out, err := resource.DecodeObject(sqlc.New(tx).ReportingOverview(ctx, f.sqlParams(reportCursor{}, "")))
		if err != nil {
			return nil, err
		}
		out["data_freshness_seconds"] = nil
		if received, ok := out["last_received_at"].(string); ok {
			if at, err := time.Parse(time.RFC3339Nano, received); err == nil {
				out["data_freshness_seconds"] = max(0, s.now().Sub(at).Seconds())
			}
		}
		return out, nil
	})(w, r)
}
