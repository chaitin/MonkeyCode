package stats

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"

	"github.com/jackc/pgx/v5"
)

func tasks(ctx context.Context, tx pgx.Tx, w window) (resource.Object, error) {
	out, err := resource.DecodeObject(sqlc.New(tx).TaskSummary(ctx, sqlc.TaskSummaryParams{FromTime: w.from, UntilTime: w.until}))
	if err != nil {
		return nil, err
	}
	trend, err := resource.DecodeObjects(sqlc.New(tx).TaskTrend(ctx, sqlc.TaskTrendParams{FromTime: w.from, UntilTime: w.until, StepSeconds: int64(w.step.Seconds())}))
	if err != nil {
		return nil, err
	}
	types, err := resource.DecodeObjects(sqlc.New(tx).TaskTypes(ctx, sqlc.TaskTypesParams{StartedAt: w.from, StartedAt_2: w.until}))
	if err != nil {
		return nil, err
	}
	out["trend"], out["types"] = trend, types
	return out, nil
}
