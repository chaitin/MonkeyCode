package stats

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"
	"github.com/jackc/pgx/v5"
)

func tasks(ctx context.Context, tx pgx.Tx, w window) (resource.Object, error) {
	q := sqlc.New(tx)
	summary, err := resource.DecodeObject(q.ReportingTaskSummary(ctx, sqlc.ReportingTaskSummaryParams{FromTime: w.from, UntilTime: w.until}))
	if err != nil {
		return nil, err
	}
	previousFrom := w.from.Add(-w.until.Sub(w.from))
	previous, err := resource.DecodeObject(q.ReportingTaskSummary(ctx, sqlc.ReportingTaskSummaryParams{FromTime: previousFrom, UntilTime: w.from}))
	if err != nil {
		return nil, err
	}
	trend, err := resource.DecodeObjects(q.ReportingTaskTrend(ctx, sqlc.ReportingTaskTrendParams{FromTime: w.from, UntilTime: w.until, StepSeconds: int64(w.step.Seconds())}))
	if err != nil {
		return nil, err
	}
	types, err := resource.DecodeObjects(q.ReportingTaskTypes(ctx, sqlc.ReportingTaskTypesParams{FromTime: w.from, UntilTime: w.until}))
	if err != nil {
		return nil, err
	}
	sessions, err := q.ReportingTaskSessions(ctx, sqlc.ReportingTaskSessionsParams{FromTime: w.from, UntilTime: w.until})
	if err != nil {
		return nil, err
	}
	return resource.Object{"summary": summary, "previous": previous, "trend": trend, "types": types, "sessions": sessions}, nil
}
