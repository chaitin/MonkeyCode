package kb

import (
	"context"
	"fmt"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	OperationLearn          = "learn"
	OperationRelearn        = "relearn"
	OperationRebuildParse   = "rebuild_parse"
	OperationRebuildLexical = "rebuild_lexical"
	OperationRebuildVector  = "rebuild_vector"
	OperationRebuildModel   = "rebuild_model"
)

func (s *Service) SwitchEmbeddingModel(ctx context.Context, id, modelID, match string) (resource.Object, error) {
	modelID = strings.TrimSpace(modelID)
	current, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if match == "" {
		return nil, &resource.Error{Status: 428, Code: "precondition_required", Message: "切换向量模型需要 If-Match"}
	}
	if match != fmt.Sprintf(`"%v"`, current["revision"]) {
		return nil, resource.Conflict
	}
	currentModelID := strings.TrimSpace(current.String("embedding_model_id"))
	if modelID == currentModelID && objectInt64(current["embedding_dimension"]) > 0 {
		return nil, &resource.Error{Status: 409, Code: "embedding_model_unchanged", Message: "目标向量模型与当前模型相同"}
	}
	var dimension int
	if modelID != "" {
		if _, err := uuid.Parse(modelID); err != nil {
			return nil, resource.InvalidCode("embedding_model_unavailable", "向量模型不存在、未启用或已被删除")
		}
		value, err := sqlc.New(s.store.Pool).GetEmbeddingModel(ctx, modelID)
		if err != nil {
			return nil, resource.InvalidCode("embedding_model_unavailable", "向量模型不存在、未启用或已被删除")
		}
		if value <= 0 {
			return nil, resource.InvalidCode("embedding_dimension_invalid", "向量模型缺少可用维度，请先测试并保存模型")
		}
		dimension = int(value)
	}
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx, id)
	queries := sqlc.New(tx)
	data, err := queries.LockKbResource(ctx, id)
	if err != nil {
		return nil, err
	}
	locked, err := resource.DecodeObject(data, nil)
	if err != nil {
		return nil, err
	}
	if match != fmt.Sprintf(`"%v"`, locked["revision"]) || strings.TrimSpace(locked.String("embedding_model_id")) != currentModelID {
		return nil, resource.Conflict
	}
	if err = queries.CancelKbLearningJobs(ctx, id); err != nil {
		return nil, err
	}
	var dimensionValue *int32
	if dimension > 0 {
		value := int32(dimension)
		dimensionValue = &value
	}
	if err = queries.SetKbEmbeddingModel(ctx, sqlc.SetKbEmbeddingModelParams{
		EmbeddingModelID:   modelID,
		EmbeddingDimension: dimensionValue,
		ID:                 id,
	}); err != nil {
		return nil, err
	}
	if err = queries.ClearKbVectors(ctx, id); err != nil {
		return nil, err
	}
	if err = scheduleKbDocumentJobs(ctx, queries, id, modelID, dimension, modelID != ""); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	item, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if modelID == "" {
		item["notice"] = "已清空历史向量，全文检索保留；后续有可用向量模型时会自动绑定"
	} else {
		item["notice"] = "向量模型已切换，历史向量已清空，正在重建向量索引"
	}
	return item, nil
}

func (s *Service) RebuildIndex(ctx context.Context, id, operation, modelID, match string) (resource.Object, error) {
	operation = strings.TrimSpace(operation)
	switch operation {
	case OperationRebuildVector:
		if err := s.syncEmbeddingModel(ctx, id); err != nil {
			return nil, err
		}
		item, err := s.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		if !embeddingReady(item) {
			return nil, embeddingNotConfigured()
		}
		if err := s.resetKbVectorIndex(ctx, id); err != nil {
			return nil, err
		}
	case OperationLearn, OperationRelearn, OperationRebuildParse, OperationRebuildLexical:
		if err := s.scheduleIndexJob(ctx, id, operation); err != nil {
			return nil, err
		}
	case OperationRebuildModel:
		if strings.TrimSpace(modelID) == "" {
			return nil, resource.Invalid("model_id 不能为空")
		}
		return s.SwitchEmbeddingModel(ctx, id, modelID, match)
	default:
		return nil, resource.Invalid("不支持的索引重建操作")
	}
	return s.Get(ctx, id)
}

func (s *Service) scheduleIndexJob(ctx context.Context, kbID, operation string) error {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, kbID)
	queries := sqlc.New(tx)
	if _, err = queries.LockKbResource(ctx, kbID); err != nil {
		return err
	}
	if err = scheduleLearningJob(ctx, tx, kbID, operation); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func scheduleLearningJob(ctx context.Context, tx pgx.Tx, kbID, operation string) error {
	queries := sqlc.New(tx)
	if err := queries.CancelKbLearningJobs(ctx, kbID); err != nil {
		return err
	}
	if operation == OperationRebuildLexical {
		if err := requeueUnfinishedKbDocuments(ctx, queries, kbID); err != nil {
			return err
		}
	}
	binding, err := queries.GetKbEmbedding(ctx, kbID)
	if err != nil {
		return err
	}
	params := sqlc.CreateKbLearningJobParams{KbID: kbID, Operation: operation}
	modelID, dimension := embeddingBindingTarget(binding.EmbeddingModelID, binding.EmbeddingDimension)
	if modelID != "" && dimension > 0 {
		params.EmbeddingModelID = binding.EmbeddingModelID
		params.EmbeddingDimension = binding.EmbeddingDimension
	}
	if err := queries.CreateKbLearningJob(ctx, params); err != nil {
		return err
	}
	return nil
}

func requeueUnfinishedKbDocuments(ctx context.Context, queries *sqlc.Queries, kbID string) error {
	binding, err := queries.GetKbEmbedding(ctx, kbID)
	if err != nil {
		return err
	}
	modelID, dimension := embeddingBindingTarget(binding.EmbeddingModelID, binding.EmbeddingDimension)
	rawDocuments, err := queries.ListKbDocuments(ctx, kbID)
	if err != nil {
		return err
	}
	documents, err := resource.DecodeObjects(rawDocuments, nil)
	if err != nil {
		return err
	}
	for _, document := range documents {
		if document.String("node_type") == "folder" {
			continue
		}
		if documentHasChunks(document) || document.String("status") == "failed" {
			continue
		}
		revision, err := queries.SetKbDocumentPending(ctx, document.String("id"))
		if err != nil {
			return err
		}
		if err = createKbDocumentJob(ctx, queries, kbID, document.String("id"), OperationRelearn, revision, modelID, dimension); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) resetKbVectorIndex(ctx context.Context, kbID string) error {
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
	dimension := int(objectInt64(item["embedding_dimension"]))
	if err = queries.CancelKbLearningJobs(ctx, kbID); err != nil {
		return err
	}
	if err = queries.ClearKbVectors(ctx, kbID); err != nil {
		return err
	}
	if err = scheduleKbDocumentJobs(ctx, queries, kbID, modelID, dimension, false); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// scheduleKbDocumentJobs creates one durable job per affected document. A
// document that still has chunks only backfills vectors and never repeats
// parsing or tokenization. Documents without chunks are re-learned from their
// saved content.
func scheduleKbDocumentJobs(ctx context.Context, queries *sqlc.Queries, kbID, modelID string, dimension int, retryFailed bool) error {
	rawDocuments, err := queries.ListKbDocuments(ctx, kbID)
	if err != nil {
		return err
	}
	documents, err := resource.DecodeObjects(rawDocuments, nil)
	if err != nil {
		return err
	}
	for _, document := range documents {
		if document.String("node_type") == "folder" {
			continue
		}
		documentID := document.String("id")
		status := document.String("status")
		if documentHasChunks(document) {
			if modelID != "" && dimension > 0 {
				revision, err := queries.SetKbDocumentVectorLearning(ctx, documentID)
				if err != nil {
					return err
				}
				if err = createKbDocumentJob(ctx, queries, kbID, documentID, OperationRebuildVector, revision, modelID, dimension); err != nil {
					return err
				}
			} else if status != "learned" && status != "failed" {
				if err = queries.SetKbDocumentLexicallyLearned(ctx, documentID); err != nil {
					return err
				}
			}
			continue
		}
		if status == "failed" && !retryFailed {
			continue
		}
		revision, err := queries.SetKbDocumentPending(ctx, documentID)
		if err != nil {
			return err
		}
		if err = createKbDocumentJob(ctx, queries, kbID, documentID, OperationRelearn, revision, modelID, dimension); err != nil {
			return err
		}
	}
	return nil
}

func createKbDocumentJob(ctx context.Context, queries *sqlc.Queries, kbID, documentID, operation string, revision int32, modelID string, dimension int) error {
	params := sqlc.CreateKbLearningJobParams{
		KbID:             kbID,
		DocumentID:       &documentID,
		Operation:        operation,
		DocumentRevision: &revision,
	}
	if modelID != "" && dimension > 0 {
		value := int32(dimension)
		params.EmbeddingModelID = &modelID
		params.EmbeddingDimension = &value
	}
	return queries.CreateKbLearningJob(ctx, params)
}

func (s *Service) rebuildLexicalIndex(ctx context.Context, job sqlc.ClaimKbLearningJobRow) error {
	kbID := job.KbID
	rows, err := sqlc.New(s.store.Pool).ListKbChunksForRebuild(ctx, kbID)
	if err != nil {
		return err
	}
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, kbID)
	queries := sqlc.New(tx)
	if _, err = queries.LockKbResource(ctx, kbID); err != nil {
		return err
	}
	if err = s.checkLearningJob(ctx, queries, job); err != nil {
		return err
	}
	for _, row := range rows {
		tokens := tokenizeText(row.Content)
		if tokens == "" {
			return fmt.Errorf("分片 %s 未生成可检索词", row.ID)
		}
		if err = queries.UpdateKbChunkLexical(ctx, sqlc.UpdateKbChunkLexicalParams{SearchTokens: tokens, ID: row.ID}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type rebuiltVector struct {
	id        string
	embedding string
	metadata  string
}

func (s *Service) rebuildVectorIndex(ctx context.Context, job sqlc.ClaimKbLearningJobRow, modelID string, dimension int) error {
	kbID := job.KbID
	vectors, err := s.buildVectorIndex(ctx, kbID, modelID, dimension)
	if err != nil {
		return err
	}
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, kbID)
	queries := sqlc.New(tx)
	current, err := resource.DecodeObject(queries.LockKbResource(ctx, kbID))
	if err != nil {
		return err
	}
	if err = s.checkLearningJob(ctx, queries, job); err != nil {
		return err
	}
	if current.String("embedding_model_id") != modelID || objectInt64(current["embedding_dimension"]) != int64(dimension) {
		return errLearningJobCanceled
	}
	if err = s.applyVectors(ctx, queries, modelID, vectors); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) buildVectorIndex(ctx context.Context, kbID, modelID string, dimension int) ([]rebuiltVector, error) {
	if s.models == nil {
		return nil, resource.InvalidCode("vector_unavailable", "向量模型服务不可用")
	}
	if dimension <= 0 {
		return nil, resource.InvalidCode("embedding_dimension_invalid", "向量模型缺少可用维度")
	}
	rows, err := sqlc.New(s.store.Pool).ListKbChunksForRebuild(ctx, kbID)
	if err != nil {
		return nil, err
	}
	vectors := make([]rebuiltVector, 0, len(rows))
	for index, row := range rows {
		result, embedErr := s.models.EmbedText(ctx, modelID, row.Content)
		if embedErr != nil {
			return nil, resource.InvalidCode("vector_unavailable", fmt.Sprintf("分片 %d 向量化失败: %v", index, embedErr))
		}
		if len(result.Vector) != dimension {
			return nil, resource.InvalidCode("vector_dimension_mismatch", fmt.Sprintf("向量维度不匹配: 配置 %d，实际 %d", dimension, len(result.Vector)))
		}
		vector, formatErr := formatVector(result.Vector)
		if formatErr != nil {
			return nil, resource.InvalidCode("vector_unavailable", formatErr.Error())
		}
		vectors = append(vectors, rebuiltVector{id: row.ID, embedding: vector, metadata: "{}"})
	}
	return vectors, nil
}

func (s *Service) applyVectors(ctx context.Context, queries *sqlc.Queries, modelID string, vectors []rebuiltVector) error {
	for _, vector := range vectors {
		model := modelID
		if err := queries.UpdateKbChunkVector(ctx, sqlc.UpdateKbChunkVectorParams{
			Embedding:        &vector.embedding,
			EmbeddingModelID: &model,
			Metadata:         vector.metadata,
			ID:               vector.id,
		}); err != nil {
			return err
		}
	}
	return nil
}
