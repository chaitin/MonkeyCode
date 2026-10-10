package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func groupedPage(ctx context.Context, f reportingFilter, fetch func(context.Context, []byte) ([][]byte, error)) (resource.Object, error) {
	cursor, err := f.decodeCursor()
	if err != nil {
		return nil, err
	}
	items, err := resource.DecodeObjects(fetch(ctx, f.sqlParams(cursor, "")))
	if err != nil {
		return nil, err
	}
	out := resource.Object{"items": items, "next_cursor": nil, "pagination": "cursor"}
	if len(items) > f.limit {
		items = items[:f.limit]
		out["items"] = items
		out["next_cursor"] = f.encodeCursor(reportCursor{Key: items[len(items)-1]["sort_key"].(string)})
	}
	return out, nil
}

func (s *Service) reportingFreshness(ctx context.Context, tx pgx.Tx, f reportingFilter) (any, error) {
	value, err := sqlc.New(tx).ReportingFreshness(ctx, f.sqlParams(reportCursor{}, ""))
	if err != nil || value == nil {
		return nil, err
	}
	var at time.Time
	switch v := value.(type) {
	case time.Time:
		at = v
	case *time.Time:
		if v != nil {
			at = *v
		}
	case pgtype.Timestamptz:
		if v.Valid {
			at = v.Time
		}
	}
	if at.IsZero() {
		return nil, nil
	}
	return max(0, s.now().Sub(at).Seconds()), nil
}

func (s *Service) reportingResources(w http.ResponseWriter, r *http.Request) {
	s.reportingRead(false, func(ctx context.Context, tx pgx.Tx, f reportingFilter) (resource.Object, error) {
		out, err := groupedPage(ctx, f, sqlc.New(tx).ReportingResources)
		if err != nil {
			return nil, err
		}
		out["data_freshness_seconds"], err = s.reportingFreshness(ctx, tx, f)
		return out, err
	})(w, r)
}

func (s *Service) reportingClients(w http.ResponseWriter, r *http.Request) {
	s.reportingRead(false, func(ctx context.Context, tx pgx.Tx, f reportingFilter) (resource.Object, error) {
		out, err := groupedPage(ctx, f, sqlc.New(tx).ReportingClients)
		if err != nil {
			return nil, err
		}
		out["data_freshness_seconds"], err = s.reportingFreshness(ctx, tx, f)
		return out, err
	})(w, r)
}
