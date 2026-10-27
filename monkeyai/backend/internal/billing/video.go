package billing

import (
	"context"
	"fmt"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
)

const MaxVideoDurationMs int64 = 30_000

func QuoteVideo(unit Amount, durationMs int64) (Amount, error) {
	return priceVideo(unit, durationMs)
}

func (s *Service) VideoCharge(ctx context.Context, transactionID, userID string) (Amount, error) {
	row, err := sqlc.New(s.pool).VideoCharge(ctx, sqlc.VideoChargeParams{ID: transactionID, UserID: userID})
	if err != nil {
		return 0, fmt.Errorf("读取视频交易 %s 的结算结果: %w", transactionID, err)
	}
	if row.Status != "settled" && row.Status != "released" {
		return 0, &VideoChargeError{TransactionID: transactionID, Status: row.Status, Code: row.ErrorCode}
	}
	return ParseAmount(row.RawAmount)
}

type VideoChargeError struct {
	TransactionID string
	Status        string
	Code          string
}

func (e *VideoChargeError) Error() string {
	return fmt.Sprintf("视频交易 %s 尚未结算: status=%s error_code=%s", e.TransactionID, e.Status, e.Code)
}

func (e *VideoChargeError) DiagnosticCode() string {
	if e.Code != "" {
		return e.Code
	}
	return "video_billing_pending"
}
