package billing

import (
	"context"
	"encoding/json"
	"fmt"
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
	State ReconciliationState
	Usage Usage
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
		if row.Attempts >= maxReconciliationAttempts {
			if _, err := sqlc.New(s.pool).StopReconciliation(ctx, row.ID); err != nil {
				return err
			}
			slog.WarnContext(ctx, "模型用量自动对账已停止", "transaction_id", row.ID, "attempts", row.Attempts)
			continue
		}
		attemptCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := s.reconcileUsage(attemptCtx, row)
		cancel()
		if err == nil {
			continue
		}
		slog.WarnContext(ctx, "模型用量自动对账失败", "transaction_id", row.ID, "error", err)
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
			conn.Conn().Close(releaseCtx)
		}
	}()

	status, err := sqlc.New(conn).TransactionStatus(ctx, row.ID)
	if err != nil {
		return err
	}
	if status != "unknown" {
		return nil
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
		return err
	case ReconciliationUnsupported:
		_, err = sqlc.New(conn).StopReconciliation(ctx, row.ID)
		return err
	case ReconciliationResolved:
		if !result.Usage.Known {
			_, err = sqlc.New(conn).StopReconciliation(ctx, row.ID)
			if err == nil {
				slog.ErrorContext(ctx, "对账器返回了不可信用量", "transaction_id", row.ID)
			}
			return err
		}
	default:
		_, err = sqlc.New(conn).StopReconciliation(ctx, row.ID)
		if err == nil {
			slog.ErrorContext(ctx, "对账器返回了未知结果", "transaction_id", row.ID, "state", result.State)
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
	slog.InfoContext(ctx, "模型用量自动对账已补全", "transaction_id", row.ID, "request_id", row.RequestID)
	return nil
}
