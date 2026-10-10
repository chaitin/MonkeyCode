package stats

import (
	"context"
	"encoding/json"
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

func (s *Service) reportingSessions(w http.ResponseWriter, r *http.Request) {
	s.reportingRead(true, func(ctx context.Context, tx pgx.Tx, f reportingFilter) (resource.Object, error) {
		c, err := f.decodeCursor()
		if err != nil {
			return nil, err
		}
		raw, err := sqlc.New(tx).ReportingSessions(ctx, f.sqlParams(c, ""))
		if err != nil {
			return nil, err
		}
		items := make([]resource.Object, 0, len(raw))
		for _, value := range raw {
			data, ok := value.([]byte)
			if !ok {
				data, err = json.Marshal(value)
			}
			if err != nil {
				return nil, err
			}
			item, err := resource.DecodeObject(data, nil)
			if err != nil {
				return nil, err
			}
			items = append(items, item)
		}
		out := resource.Object{"next_cursor": nil, "pagination": "cursor"}
		if len(items) > f.limit {
			items = items[:f.limit]
			last := items[len(items)-1]
			at, _ := last["started_at"].(string)
			if at == "" {
				at, _ = last["sort_at"].(string)
			}
			out["next_cursor"] = f.encodeCursor(reportCursor{At: at, ID: last["id"].(string)})
		}
		for _, item := range items {
			delete(item, "sort_at")
		}
		out["items"] = items
		return out, nil
	})(w, r)
}
