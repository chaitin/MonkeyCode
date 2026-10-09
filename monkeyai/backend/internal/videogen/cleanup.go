package videogen

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/videogen/sqlc"
)

func (s *Service) Cleanup(ctx context.Context) error {
	queries := sqlc.New(s.pool)
	inputs, err := queries.ExpiredVideoInputs(ctx)
	if err != nil {
		return err
	}
	for _, input := range inputs {
		if err := s.storage.Delete(ctx, input.ObjectKey); err != nil {
			return err
		}
		transaction, err := s.pool.Begin(ctx)
		if err != nil {
			return err
		}
		q := sqlc.New(transaction)
		err = q.UnlinkExpiredVideoInput(ctx, input.ID)
		if err == nil {
			err = q.RemoveExpiredVideoInput(ctx, input.ID)
		}
		if err != nil {
			_ = transaction.Rollback(ctx)
			return err
		}
		if err := transaction.Commit(ctx); err != nil {
			return err
		}
	}
	outputs, err := queries.ExpiredVideoOutputs(ctx)
	if err != nil {
		return err
	}
	for _, output := range outputs {
		if err := s.storage.Delete(ctx, output.ObjectKey); err != nil {
			return err
		}
		if err := queries.MarkVideoOutputPurged(ctx, output.ID); err != nil {
			return err
		}
	}
	return nil
}
