package tasklog

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type Provider interface {
	Name() string
	LatestEventTime(ctx context.Context, taskID uuid.UUID, start, end time.Time, events []string) (time.Time, bool, error)
	QueryLatestTurn(ctx context.Context, taskID uuid.UUID, taskCreatedAt, end time.Time) (*QueryLatestTurnResp, error)
	QueryTurns(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, opts QueryTurnsOpts) (*QueryTurnsResp, error)
	QueryUserInputs(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, cursor string, limit int) (*QueryUserInputsResp, error)
}
