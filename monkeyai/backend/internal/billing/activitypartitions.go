package billing

import (
	"context"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
)

var activityTables = [...]string{"billing_transactions", "model_calls", "mcp_tool_calls", "image_calls", "video_calls"}

// Mutable transaction/call maintenance runs independently of wallet recovery and
// the immutable ledger worker. Database advisory locks coordinate all replicas.
func (s *Service) runActivityPartitions(ctx context.Context) {
	checks := make(map[string]time.Time, len(activityTables))
	query := sqlc.New(s.pool)
	for ctx.Err() == nil {
		delay := time.Minute
		for _, name := range activityTables {
			if ctx.Err() != nil {
				return
			}
			if !s.now().Before(checks[name]) {
				c, cancel := context.WithTimeout(ctx, 45*time.Second)
				ready, err := query.EnsureActivityWeeks(c, sqlc.EnsureActivityWeeksParams{TableName: name, AtTime: s.now()})
				cancel()
				if err != nil {
					if ctx.Err() == nil {
						slog.ErrorContext(ctx, "预建交易/调用周分区失败，将重试", "table", name, "error", err)
					}
				} else if ready {
					checks[name] = s.now().Add(24 * time.Hour)
				}
			}
			c, cancel := context.WithTimeout(ctx, 30*time.Second)
			copied, err := query.CopyActivityBatch(c, name)
			cancel()
			if err != nil {
				if ctx.Err() == nil {
					slog.ErrorContext(ctx, "回填交易/调用周分区失败，保留原表并重试", "table", name, "error", err)
				}
				continue
			}
			if copied > 0 {
				delay = 10 * time.Millisecond
			} else if copied == 0 {
				c, cancel = context.WithTimeout(ctx, 10*time.Minute)
				ready, err := query.CutoverActivity(c, name)
				cancel()
				if err != nil && ctx.Err() == nil {
					slog.ErrorContext(ctx, "切换交易/调用周分区失败，保留原表并重试", "table", name, "error", err)
				} else if ready {
					slog.InfoContext(ctx, "交易/调用周分区回填校验及切换完成，保留旧表镜像", "table", name)
					delay = 10 * time.Millisecond
				}
			}
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
