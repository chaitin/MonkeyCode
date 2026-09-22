package imagegen

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func (s *Inputs) Cleanup(ctx context.Context, limit int32) (int, error) {
	if limit < 1 || limit > 100 {
		return 0, resource.Invalid("清理批次大小无效")
	}
	queries := sqlc.New(s.repo.pool)
	inputs, err := queries.ExpiredInputs(ctx, limit)
	if err != nil {
		return 0, err
	}
	cleaned := 0
	for _, input := range inputs {
		if err := s.storage.Delete(ctx, input.ObjectKey); err != nil {
			return cleaned, err
		}
		if err := queries.UnlinkExpiredInput(ctx, input.ID); err != nil {
			return cleaned, err
		}
		if _, err := queries.RemoveExpiredInput(ctx, input.ID); err != nil {
			return cleaned, err
		}
		cleaned++
	}
	outputs, err := queries.ExpiredOutputs(ctx, limit)
	if err != nil {
		return cleaned, err
	}
	for _, output := range outputs {
		if err := s.storage.Delete(ctx, output.ObjectKey); err != nil {
			return cleaned, err
		}
		if _, err := queries.MarkOutputPurged(ctx, output.ID); err != nil {
			return cleaned, err
		}
		cleaned++
	}
	return cleaned, nil
}
