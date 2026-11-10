package kb

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"

	"github.com/jackc/pgx/v5"
)

const learningWorkerPollInterval = time.Second
const embeddingSyncInterval = 5 * time.Second

// Run consumes durable learning jobs until the application context is canceled.
// A single worker keeps embedding pressure bounded; the claim query still uses
// SKIP LOCKED so additional workers can be added without changing job semantics.
func (s *Service) Run(ctx context.Context) {
	// Reconcile independently so a long embedding task cannot delay discovering
	// newly available models. Stop the reconciler before Run returns.
	syncCtx, cancelSync := context.WithCancel(ctx)
	syncDone := make(chan struct{})
	go func() {
		defer close(syncDone)
		s.runEmbeddingSync(syncCtx)
	}()
	defer func() { cancelSync(); <-syncDone }()

	ticker := time.NewTicker(learningWorkerPollInterval)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		worked, err := s.runLearningJob(ctx)
		if err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "知识库学习任务执行失败", "module", "kb", "operation", "run_learning_job", "error", err)
		}
		if worked {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) runLearningJob(ctx context.Context) (bool, error) {
	queries := sqlc.New(s.store.Pool)
	worker := s.workerID()
	job, err := queries.ClaimKbLearningJob(ctx, &worker)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	err = s.executeLearningJob(ctx, job)
	if errors.Is(err, errLearningJobCanceled) {
		return true, nil
	}
	if err != nil {
		message := err.Error()
		if len([]rune(message)) > 2000 {
			message = string([]rune(message)[:2000])
		}
		failErr := queries.FailKbLearningJob(ctx, sqlc.FailKbLearningJobParams{
			ID:           job.ID,
			Attempts:     job.Attempts,
			WorkerID:     &worker,
			ErrorMessage: &message,
		})
		return true, errors.Join(err, failErr)
	}
	return true, queries.FinishKbLearningJob(ctx, sqlc.FinishKbLearningJobParams{ID: job.ID, Attempts: job.Attempts, WorkerID: &worker})
}

func (s *Service) executeLearningJob(ctx context.Context, job sqlc.ClaimKbLearningJobRow) error {
	if err := s.syncEmbeddingModel(ctx, job.KbID); err != nil {
		return err
	}
	switch job.Operation {
	case OperationLearn, OperationRelearn, OperationRebuildParse:
		if job.DocumentID != nil {
			err := s.learnDocument(ctx, *job.DocumentID, job)
			if errors.Is(err, errDocumentChanged) {
				return nil
			}
			return err
		}
		documents, err := s.ListDocuments(ctx, job.KbID)
		if err != nil {
			return err
		}
		for _, document := range documents {
			documentID := document.String("id")
			if err = s.learnDocument(ctx, documentID, job); err != nil {
				if errors.Is(err, errDocumentChanged) {
					continue
				}
				return err
			}
		}
		return nil
	case OperationRebuildLexical:
		return s.rebuildLexicalIndex(ctx, job)
	case OperationRebuildVector:
		if job.DocumentID != nil {
			err := s.rebuildDocumentVector(ctx, *job.DocumentID, job)
			if errors.Is(err, errDocumentChanged) {
				return nil
			}
			return err
		}
		return s.rebuildVectorForKB(ctx, job)
	case OperationRebuildModel:
		if job.DocumentID != nil {
			err := s.rebuildDocumentVector(ctx, *job.DocumentID, job)
			if errors.Is(err, errDocumentChanged) {
				return nil
			}
			return err
		}
		return s.rebuildVectorForKB(ctx, job)
	default:
		return errors.New("不支持的异步学习任务")
	}
}

func (s *Service) rebuildVectorForKB(ctx context.Context, job sqlc.ClaimKbLearningJobRow) error {
	item, err := s.Get(ctx, job.KbID)
	if err != nil {
		return err
	}
	modelID, dimension := learningJobTarget(job)
	if modelID == "" || dimension <= 0 {
		modelID = item.String("embedding_model_id")
		dimension = int(objectInt64(item["embedding_dimension"]))
	}
	if !embeddingReady(item) || !learningJobTargetMatches(item, modelID, dimension) {
		return nil
	}
	return s.rebuildVectorIndex(ctx, job, modelID, dimension)
}

func (s *Service) workerID() string {
	if s.worker == "" {
		return "kb-learning"
	}
	return s.worker
}

func (s *Service) runEmbeddingSync(ctx context.Context) {
	ticker := time.NewTicker(embeddingSyncInterval)
	defer ticker.Stop()
	for {
		if err := s.SyncEmbeddingModels(ctx); err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "知识库自动绑定向量模型失败", "module", "kb", "operation", "sync_embedding", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
