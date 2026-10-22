package billing

import (
	"context"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
)

// Keep partition maintenance independent of wallet recovery and account refresh.
// PostgreSQL coordinates replicas with a schema-scoped transaction advisory lock.
func (s *Service) runLedgerPartitions(ctx context.Context) {
	var nextCheck time.Time
	for ctx.Err() == nil {
		delay := time.Minute
		if !s.now().Before(nextCheck) {
			c, cancel := context.WithTimeout(ctx, 45*time.Second)
			ok, err := sqlc.New(s.pool).EnsureLedgerWeeks(c, s.now())
			cancel()
			if err != nil {
				if ctx.Err() == nil {
					slog.ErrorContext(ctx, "预建账本周分区失败，将重试", "error", err)
				}
			} else if ok {
				nextCheck = s.now().Add(24 * time.Hour)
				c, cancel = context.WithTimeout(ctx, 10*time.Second)
				count, err := sqlc.New(s.pool).LedgerDefaultCount(c)
				cancel()
				if err != nil && ctx.Err() == nil {
					slog.ErrorContext(ctx, "检查账本默认分区失败", "error", err)
				} else if count > 0 {
					slog.WarnContext(ctx, "账本默认分区仍有流水，请检查分区维护", "rows_at_least", count)
				}
			}
		}
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		copied, err := sqlc.New(s.pool).CopyLedgerBatch(c, 1000)
		cancel()
		if err != nil {
			if ctx.Err() == nil {
				slog.ErrorContext(ctx, "分批回填账本失败，保留旧账本并重试", "error", err)
			}
		} else if copied > 0 {
			delay = 10 * time.Millisecond
		} else if copied == 0 {
			// Validation scans both immutable copies without holding the DDL lock.
			c, cancel = context.WithTimeout(ctx, 10*time.Minute)
			ok, err := sqlc.New(s.pool).CutoverLedger(c)
			cancel()
			if err != nil && ctx.Err() == nil {
				slog.ErrorContext(ctx, "切换账本周分区失败，保留旧账本并重试", "error", err)
			} else if ok {
				slog.InfoContext(ctx, "账本周分区回填校验及切换完成，旧账本保持事务内镜像")
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
