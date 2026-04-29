package tasklog

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Provider interface {
	Name() string
	QueryLatestTurn(ctx context.Context, taskID uuid.UUID, taskCreatedAt, end time.Time) (*QueryLatestTurnResp, error)
	QueryTurns(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, cursor string, limit int) (*QueryTurnsResp, error)
}
