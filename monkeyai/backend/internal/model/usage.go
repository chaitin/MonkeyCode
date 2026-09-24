package model

import (
	"context"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model/sqlc"
)

type Call struct {
	ModelID, UserID, RequestID, Status, ErrorCode string
	InputTokens, CachedInputTokens, OutputTokens  int64
	StartedAt, CompletedAt                        time.Time
}

func (p *Postgres) RecordCall(ctx context.Context, call Call) error {
	result, err := sqlc.New(p.pool).RecordModelCall(ctx, sqlc.RecordModelCallParams{
		ModelID: call.ModelID, UserID: call.UserID, RequestID: call.RequestID,
		Status: call.Status, ErrorCode: call.ErrorCode,
		InputTokens: call.InputTokens, CachedInputTokens: call.CachedInputTokens,
		OutputTokens: call.OutputTokens, StartedAt: call.StartedAt, CompletedAt: call.CompletedAt,
	})
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	return nil
}
