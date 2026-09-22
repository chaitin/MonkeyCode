package billing

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
)

func (s *Service) ImageCharge(ctx context.Context, transactionID, userID string) (Amount, error) {
	value, err := sqlc.New(s.pool).ImageCharge(ctx, sqlc.ImageChargeParams{ID: transactionID, UserID: userID})
	if err != nil {
		return 0, err
	}
	return ParseAmount(value)
}
