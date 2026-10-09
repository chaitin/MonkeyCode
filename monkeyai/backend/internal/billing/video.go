package billing

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
)

func QuoteVideo(unit Amount, durationMs int64) (Amount, error) {
	return priceVideo(unit, durationMs)
}

func (s *Service) VideoCharge(ctx context.Context, transactionID, userID string) (Amount, error) {
	value, err := sqlc.New(s.pool).VideoCharge(ctx, sqlc.VideoChargeParams{ID: transactionID, UserID: userID})
	if err != nil {
		return 0, err
	}
	return ParseAmount(value)
}
