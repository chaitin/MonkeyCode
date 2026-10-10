package feedback

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/feedback/sqlc"
)

// Cleanup 删除进程崩溃或上传失败留下的 pending/failed 附件对象及记录。
func (s *Service) Cleanup(ctx context.Context) error {
	cutoff := s.now().Add(-cleanupAge)
	var firstErr error
	if _, err := sqlc.New(s.pool).MarkStaleUploading(ctx, cutoff); err != nil {
		firstErr = err
	}
	rows, err := sqlc.New(s.pool).ListStaleAttachments(ctx, sqlc.ListStaleAttachmentsParams{
		CreatedAt: cutoff, Limit: cleanupBatchSize,
	})
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := s.storage.Delete(ctx, row.ObjectKey); err != nil {
			if firstErr == nil {
				firstErr = storageFailure()
			}
			slog.WarnContext(ctx, "清理过期反馈附件对象失败", "feedback_id", row.FeedbackID, "attachment_id", row.ID, "error_type", errorType(err))
			continue
		}
		if _, err := sqlc.New(s.pool).DeleteAttachment(ctx, row.ID); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			slog.WarnContext(ctx, "清理过期反馈附件记录失败", "feedback_id", row.FeedbackID, "attachment_id", row.ID, "error_type", errorType(err))
		}
	}
	return firstErr
}

// Run 按周期执行补偿清理，ctx 结束后返回。
func (s *Service) Run(ctx context.Context, interval time.Duration) error {
	if interval <= 0 {
		interval = time.Hour
	}
	if err := s.Cleanup(ctx); err != nil && !errors.Is(err, context.Canceled) {
		slog.WarnContext(ctx, "反馈附件初次清理失败", "error", err)
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := s.Cleanup(ctx); err != nil && !errors.Is(err, context.Canceled) {
				slog.WarnContext(ctx, "反馈附件周期清理失败", "error", err)
			}
		}
	}
}
