package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
)

type ReconciliationState string

const (
	ReconciliationResolved    ReconciliationState = "resolved"
	ReconciliationPending     ReconciliationState = "pending"
	ReconciliationUnsupported ReconciliationState = "unsupported"
)

type ReconciliationRequest struct {
	TransactionID string
	ResourceID    string
	RequestID     string
}

type ReconciliationResult struct {
	State          ReconciliationState
	Usage          Usage
	Reason         string
	UpstreamStatus int
}

type UsageReconciler interface {
	Reconcile(context.Context, ReconciliationRequest) (ReconciliationResult, error)
}

const maxReconciliationAttempts = 8

func (s *Service) reconcileUnknown(ctx context.Context) error {
	if s.reconciler == nil {
		return nil
	}
	rows, err := sqlc.New(s.pool).TransactionsToReconcile(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		attemptCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := s.reconcileUsage(attemptCtx, row)
		cancel()
		if err == nil {
			continue
		}
		logging.Event(ctx, slog.Default(), slog.LevelWarn, "billing.operation.warn", "模型用量自动对账失败", "module", "billing", "operation", "reconcileUnknown", "transaction_id", row.ID, "error", err)
		if _, scheduleErr := sqlc.New(s.pool).ScheduleRetry(ctx, row.ID); scheduleErr != nil {
			return scheduleErr
		}
	}
	return nil
}

func (s *Service) reconcileUsage(ctx context.Context, row sqlc.TransactionsToReconcileRow) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	locked, err := sqlc.New(conn).TryReconciliationLock(ctx, row.ID)
	if err != nil {
		return err
	}
	if !locked {
		return nil
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, releaseErr := sqlc.New(conn).ReleaseReconciliationLock(releaseCtx, row.ID); releaseErr != nil {
			logging.Event(releaseCtx, slog.Default(), slog.LevelError, "billing.operation.error", "释放对账锁失败", "module", "billing", "operation", "reconcileUsage", "transaction_id", row.ID, "operation", "release_reconciliation_lock", "error", releaseErr)
			if closeErr := conn.Conn().Close(releaseCtx); closeErr != nil {
				logging.Event(releaseCtx, slog.Default(), slog.LevelError, "billing.operation.error", "关闭对账连接失败", "module", "billing", "operation", "reconcileUsage", "transaction_id", row.ID, "operation", "close_reconciliation_connection", "error", closeErr)
			}
		}
	}()

	status, err := sqlc.New(conn).TransactionStatus(ctx, row.ID)
	if err != nil {
		return err
	}
	if status != "unknown" {
		return nil
	}
	if row.Attempts >= maxReconciliationAttempts {
		return stopReconciliation(ctx, sqlc.New(conn), row, "attempts_exhausted", 0)
	}
	result, err := s.reconciler.Reconcile(ctx, ReconciliationRequest{
		TransactionID: row.ID,
		ResourceID:    row.ResourceID,
		RequestID:     row.RequestID,
	})
	if err != nil {
		return err
	}
	switch result.State {
	case ReconciliationPending:
		_, err = sqlc.New(conn).ScheduleRetry(ctx, row.ID)
		if err == nil {
			logging.Event(ctx, slog.Default(), slog.LevelInfo, "billing.reconciliation.pending", "模型用量等待再次对账", "module", "billing", "transaction_id", row.ID, "model_id", row.ResourceID, "response_id", row.RequestID, "attempts", row.Attempts+1, "reason", result.Reason, "upstream_status", result.UpstreamStatus)
		}
		return err
	case ReconciliationUnsupported:
		return stopReconciliation(ctx, sqlc.New(conn), row, result.Reason, result.UpstreamStatus)
	case ReconciliationResolved:
		if !result.Usage.Known {
			_, err = sqlc.New(conn).StopReconciliation(ctx, row.ID)
			if err == nil {
				logging.Event(ctx, slog.Default(), slog.LevelError, "billing.operation.error", "对账器返回了不可信用量", "module", "billing", "operation", "reconcileUsage", "transaction_id", row.ID)
			}
			return err
		}
	default:
		_, err = sqlc.New(conn).StopReconciliation(ctx, row.ID)
		if err == nil {
			logging.Event(ctx, slog.Default(), slog.LevelError, "billing.operation.error", "对账器返回了未知结果", "module", "billing", "operation", "reconcileUsage", "transaction_id", row.ID, "state", result.State)
		}
		return err
	}

	var original Usage
	if err := json.Unmarshal(row.Usage, &original); err != nil {
		return fmt.Errorf("读取原始用量证据: %w", err)
	}
	result.Usage.Stream = original.Stream
	result.Usage.TerminalEvent = original.TerminalEvent
	result.Usage.InitialErrorCode = row.ErrorCode
	result.Usage.Reconciled = true
	if result.Usage.RequestID == "" {
		result.Usage.RequestID = row.RequestID
	}
	if err := s.Finish(ctx, row.ID, result.Usage); err != nil {
		return err
	}
	logging.Event(ctx, slog.Default(), slog.LevelInfo, "billing.operation.info", "模型用量自动对账已补全", "module", "billing", "operation", "reconcileUsage", "transaction_id", row.ID, "request_id", row.RequestID)
	return nil
}

func stopReconciliation(ctx context.Context, q *sqlc.Queries, row sqlc.TransactionsToReconcileRow, reason string, status int) error {
	if reason == "" {
		reason = "unsupported"
	}
	changed, err := q.StopReconciliation(ctx, row.ID)
	if err == nil && changed.RowsAffected() > 0 {
		logging.Event(ctx, slog.Default(), slog.LevelWarn, "billing.reconciliation.stopped", "模型用量自动对账已停止",
			"module", "billing", "operation", "reconcileUnknown", "transaction_id", row.ID, "model_id", row.ResourceID,
			"response_id", row.RequestID, "attempts", row.Attempts, "reason", reason, "usage_error_code", row.ErrorCode, "upstream_status", status)
	}
	return err
}
