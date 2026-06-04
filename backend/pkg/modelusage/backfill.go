package modelusage

import (
	"context"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/taskusagestat"
	"github.com/chaitin/MonkeyCode/backend/pkg/clickhouse"
)

type BackfillOptions struct {
	Start     time.Time
	End       time.Time
	BatchSize int
	Logger    *slog.Logger
}

func Backfill(ctx context.Context, dbClient *db.Client, ch ClickHouse, opts BackfillOptions) error {
	if dbClient == nil || ch == nil {
		return nil
	}
	if opts.BatchSize <= 0 {
		opts.BatchSize = 500
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	resolver := NewEntContextRepo(dbClient)
	offset := 0
	for {
		query := dbClient.TaskUsageStat.Query().
			Order(taskusagestat.ByCreatedAt()).
			Limit(opts.BatchSize).
			Offset(offset)
		if !opts.Start.IsZero() {
			query = query.Where(taskusagestat.CreatedAtGTE(opts.Start))
		}
		if !opts.End.IsZero() {
			query = query.Where(taskusagestat.CreatedAtLT(opts.End))
		}
		rows, err := query.All(ctx)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, row := range rows {
			tk, err := dbClient.Task.Query().
				Where(task.IDEQ(row.TaskID)).
				Only(ctx)
			if err != nil {
				logger.WarnContext(ctx, "skip model usage backfill row without task", "task_id", row.TaskID, "error", err)
				continue
			}
			usageCtx, err := resolver.Resolve(ctx, row.TaskID, tk.UserID)
			if err != nil {
				logger.WarnContext(ctx, "skip model usage backfill row", "task_id", row.TaskID, "user_id", tk.UserID, "error", err)
				continue
			}
			event := clickhouse.ModelUsageEvent{
				EventTime:    row.CreatedAt,
				TeamID:       usageCtx.TeamID.String(),
				UserID:       tk.UserID.String(),
				TaskID:       row.TaskID.String(),
				ProjectID:    usageCtx.ProjectID.String(),
				ModelName:    row.Model,
				InputTokens:  uint64(row.InputTokens),
				OutputTokens: uint64(row.OutputTokens),
				CachedTokens: 0,
				TotalTokens:  uint64(row.TotalTokens),
				RequestCount: 1,
				Success:      true,
				Source:       "backfill",
			}
			if err := ch.InsertModelUsageEvent(ctx, event); err != nil {
				return err
			}
		}
		if len(rows) < opts.BatchSize {
			return nil
		}
		offset += len(rows)
	}
}
