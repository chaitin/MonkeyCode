package session

import (
	"context"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
)

// Run maintains monthly partitions and resumable historical facts/counters.
// Schema-scoped advisory locks coordinate replicas independently of billing.
func (s *Service) Run(ctx context.Context) {
	var nextCheck time.Time
	q := sqlc.New(s.pool)
	for ctx.Err() == nil {
		delay := time.Minute
		if !s.now().Before(nextCheck) {
			c, cancel := context.WithTimeout(ctx, 45*time.Second)
			ready, err := q.EnsureTurnMonths(c, s.now())
			cancel()
			if err != nil && ctx.Err() == nil {
				slog.ErrorContext(ctx, "维护轮次月分区失败，将重试", "error", err)
			} else if ready {
				nextCheck = s.now().Add(24 * time.Hour)
			}
		}
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		calibrated, err := q.CalibrateTurnCounts(c)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "校准会话轮次数失败，将重试", "error", err)
		} else if calibrated > 0 {
			delay = 10 * time.Millisecond
		}
		c, cancel = context.WithTimeout(ctx, 30*time.Second)
		copied, err := q.CopyTurnBatch(c)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "回填轮次月分区失败，保留原表并重试", "error", err)
		} else if copied > 0 {
			delay = 10 * time.Millisecond
		} else if copied == 0 {
			c, cancel = context.WithTimeout(ctx, 10*time.Minute)
			ready, err := q.CutoverTurns(c)
			cancel()
			if err != nil && ctx.Err() == nil {
				slog.ErrorContext(ctx, "切换轮次月分区失败，保留原表并重试", "error", err)
			} else if ready {
				slog.InfoContext(ctx, "轮次月分区切换完成，保留原表镜像")
				delay = 10 * time.Millisecond
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
