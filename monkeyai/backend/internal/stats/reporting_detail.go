package stats

import (
	"context"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) reportingDetail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var uuid pgtype.UUID
	if err := uuid.Scan(id); err != nil || !uuid.Valid {
		w.Header().Set("Cache-Control", "private, no-store")
		resource.Fail(w, resource.Invalid("会话 ID 无效"))
		return
	}
	s.reportingRead(true, func(ctx context.Context, tx pgx.Tx, f reportingFilter) (resource.Object, error) {
		if f.cursor != "" {
			return nil, unexpectedCursor()
		}
		q := sqlc.New(tx)
		status, err := resource.DecodeObject(q.ReportingSessionStatus(ctx, id))
		if err != nil {
			return nil, err
		}
		if status["tombstone"] == true {
			if !f.purged || !s.canReadPurged(r) {
				return nil, purgedSession()
			}
			return status, nil
		}
		return resource.DecodeObject(q.ReportingDetail(ctx, f.sqlParams(reportCursor{}, id)))
	})(w, r)
}
