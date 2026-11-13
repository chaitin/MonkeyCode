package kb

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
)

// SyncEmbeddingModels reconciles every knowledge base whose automatic binding
// or currently bound model needs attention. Model create/update/delete hooks
// call this immediately; startup and periodic scans call it as compensation.
func (s *Service) SyncEmbeddingModels(ctx context.Context) error {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	ids, err := sqlc.New(s.store.Pool).ListKbEmbeddingSyncCandidates(ctx)
	if err != nil {
		return err
	}
	var failures []error
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.reconcileEmbeddingModel(ctx, id); err != nil {
			failures = append(failures, fmt.Errorf("knowledge base %s: %w", id, err))
		}
	}
	return errors.Join(failures...)
}

func (s *Service) syncEmbeddingModel(ctx context.Context, kbID string) error {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()
	return s.reconcileEmbeddingModel(ctx, kbID)
}

// reconcileEmbeddingModel binds every unbound knowledge base to an available
// model. A previously bound model that was disabled or deleted keeps its ID and
// falls back to lexical retrieval instead of switching to another model.
func (s *Service) reconcileEmbeddingModel(ctx context.Context, kbID string) error {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, kbID)
	queries := sqlc.New(tx)
	item, err := resource.DecodeObject(queries.LockKbResource(ctx, kbID))
	if err != nil {
		return err
	}
	modelID := strings.TrimSpace(item.String("embedding_model_id"))
	if modelID == "" {
		selectedID, dimension, err := s.resolveEmbeddingModel(ctx, tx, "")
		if err != nil {
			return err
		}
		if selectedID == "" {
			return tx.Commit(ctx)
		}
		return s.applyEmbeddingBinding(ctx, tx, kbID, selectedID, dimension)
	}

	dimension, err := queries.GetEmbeddingModel(ctx, modelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.deactivateEmbeddingBinding(ctx, tx, item)
	}
	if err != nil {
		return err
	}
	if objectInt64(item["embedding_dimension"]) == dimension {
		return tx.Commit(ctx)
	}
	return s.applyEmbeddingBinding(ctx, tx, kbID, modelID, int(dimension))
}

func (s *Service) applyEmbeddingBinding(ctx context.Context, tx pgx.Tx, kbID, modelID string, dimension int) error {
	if dimension <= 0 {
		return resource.InvalidCode("embedding_dimension_invalid", "向量模型缺少可用维度，请先测试并保存模型")
	}
	queries := sqlc.New(tx)
	if err := queries.CancelKbLearningJobs(ctx, kbID); err != nil {
		return err
	}
	value := int32(dimension)
	if err := queries.SetKbEmbeddingModel(ctx, sqlc.SetKbEmbeddingModelParams{
		ID:                 kbID,
		EmbeddingModelID:   modelID,
		EmbeddingDimension: &value,
	}); err != nil {
		return err
	}
	if err := queries.ClearKbVectors(ctx, kbID); err != nil {
		return err
	}
	if err := scheduleKbDocumentJobs(ctx, queries, kbID, modelID, dimension, true); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// deactivateEmbeddingBinding keeps the intended model id so re-enabling the
// same model can restore hybrid retrieval, but clears the active dimension and
// vectors so retrieval immediately falls back to lexical only.
func (s *Service) deactivateEmbeddingBinding(ctx context.Context, tx pgx.Tx, item resource.Object) error {
	if objectInt64(item["embedding_dimension"]) == 0 {
		return tx.Commit(ctx)
	}
	kbID := item.String("id")
	modelID := strings.TrimSpace(item.String("embedding_model_id"))
	queries := sqlc.New(tx)
	if err := queries.CancelKbLearningJobs(ctx, kbID); err != nil {
		return err
	}
	if err := queries.SetKbEmbeddingModel(ctx, sqlc.SetKbEmbeddingModelParams{
		ID:                 kbID,
		EmbeddingModelID:   modelID,
		EmbeddingDimension: nil,
	}); err != nil {
		return err
	}
	if err := queries.ClearKbVectors(ctx, kbID); err != nil {
		return err
	}
	if err := scheduleKbDocumentJobs(ctx, queries, kbID, "", 0, false); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
