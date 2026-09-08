package stats

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"

	"github.com/jackc/pgx/v5"
)

func models(ctx context.Context, tx pgx.Tx, w window) (resource.Object, error) {
	out, err := resource.DecodeObject(sqlc.New(tx).ModelSummary(ctx, sqlc.ModelSummaryParams{FromTime: w.from, UntilTime: w.until, ModelID: w.model}))
	if err != nil {
		return nil, err
	}
	trend, err := resource.DecodeObjects(sqlc.New(tx).ModelTrend(ctx, sqlc.ModelTrendParams{FromTime: w.from, UntilTime: w.until, ModelID: w.model, StepSeconds: int64(w.step.Seconds())}))
	if err != nil {
		return nil, err
	}
	options, err := resource.DecodeObjects(sqlc.New(tx).ModelOptions(ctx, sqlc.ModelOptionsParams{FromTime: w.from, UntilTime: w.until, ModelID: w.model}))
	if err != nil {
		return nil, err
	}
	out["trend"], out["models"] = trend, options
	return out, nil
}
