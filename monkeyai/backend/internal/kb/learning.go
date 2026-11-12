package kb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
)

const (
	chunkRunes   = 1200
	overlapRunes = 200
)

func splitContent(content string) []string {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	runes := []rune(content)
	chunks := make([]string, 0, (len(runes)+chunkRunes-1)/chunkRunes)
	for start := 0; start < len(runes); {
		end := min(start+chunkRunes, len(runes))
		piece := strings.TrimSpace(string(runes[start:end]))
		if piece != "" {
			chunks = append(chunks, piece)
		}
		if end == len(runes) {
			break
		}
		start = end - overlapRunes
	}
	return chunks
}

func formatVector(vector []float64) (string, error) {
	if len(vector) == 0 {
		return "", errors.New("向量为空")
	}
	parts := make([]string, len(vector))
	for i, value := range vector {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return "", errors.New("向量包含无效数值")
		}
		parts[i] = strconv.FormatFloat(value, 'f', -1, 64)
	}
	return "[" + strings.Join(parts, ",") + "]", nil
}

func approximateTokens(content string) int {
	count := len([]rune(content)) / 4
	if count < 1 {
		return 1
	}
	return count
}

type learnedChunk struct {
	content          string
	tokens           int32
	searchTokens     string
	embedding        *string
	embeddingModelID *string
	metadata         string
}

var errLearningJobCanceled = errors.New("学习任务已取消")

var errDocumentChanged = errors.New("文档已更新或删除")

func (s *Service) checkLearningJob(ctx context.Context, queries *sqlc.Queries, job sqlc.ClaimKbLearningJobRow) error {
	status, err := queries.GetKbLearningJobStatus(ctx, sqlc.GetKbLearningJobStatusParams{
		ID: job.ID, Attempts: job.Attempts, WorkerID: optionalString(s.workerID()),
	})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && status != "running" {
		return errLearningJobCanceled
	}
	return err
}

func learningJobTarget(job sqlc.ClaimKbLearningJobRow) (string, int) {
	modelID := ""
	if job.EmbeddingModelID != nil {
		modelID = strings.TrimSpace(*job.EmbeddingModelID)
	}
	dimension := 0
	if job.EmbeddingDimension != nil {
		dimension = int(*job.EmbeddingDimension)
	}
	return modelID, dimension
}

func learningJobTargetMatches(kb resource.Object, modelID string, dimension int) bool {
	if modelID == "" {
		return true
	}
	return embeddingReady(kb) &&
		strings.TrimSpace(kb.String("embedding_model_id")) == modelID &&
		int(objectInt64(kb["embedding_dimension"])) == dimension
}

func learningJobRevisionMatches(document resource.Object, job sqlc.ClaimKbLearningJobRow) bool {
	return job.DocumentRevision == nil || objectInt64(document["revision"]) == int64(*job.DocumentRevision)
}

func shouldVectorize(embedder Embedder, knowledgeBase resource.Object) bool {
	return embedder != nil && embeddingReady(knowledgeBase)
}

func (s *Service) learnDocument(ctx context.Context, id string, job sqlc.ClaimKbLearningJobRow) (resultErr error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, id)
	queries := sqlc.New(tx)
	document, err := lockDocument(ctx, queries, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errDocumentChanged
	}
	if err != nil {
		return err
	}
	if document.String("node_type") == "folder" {
		return errDocumentChanged
	}
	if !learningJobRevisionMatches(document, job) {
		return errDocumentChanged
	}
	if err = s.checkLearningJob(ctx, queries, job); err != nil {
		return err
	}
	knowledgeBase, err := resource.DecodeObject(queries.GetKbResource(ctx, document.String("kb_id")))
	if err != nil {
		return err
	}
	modelID, dimension := learningJobTarget(job)
	if !learningJobTargetMatches(knowledgeBase, modelID, dimension) {
		return errLearningJobCanceled
	}
	if err = queries.SetKbDocumentLearning(ctx, id); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	defer func() {
		if resultErr != nil && !errors.Is(resultErr, errDocumentChanged) && !errors.Is(resultErr, errLearningJobCanceled) {
			resultErr = errors.Join(resultErr, s.failLearningDocument(ctx, document, job, resultErr))
		}
	}()

	chunks := splitContent(document.String("content"))
	if len(chunks) == 0 {
		return errors.New("文档内容为空，无法学习")
	}
	vectorEnabled := modelID != "" && dimension > 0

	learned := make([]learnedChunk, 0, len(chunks))
	var vectorErr error
	if vectorEnabled && s.models == nil {
		vectorErr = resource.InvalidCode("vector_unavailable", "向量模型服务不可用")
	}
	for index, chunk := range chunks {
		searchTokens := tokenizeText(chunk)
		if searchTokens == "" {
			return fmt.Errorf("文档分片 %d 未生成可检索词", index)
		}
		learned = append(learned, learnedChunk{
			content:      chunk,
			tokens:       int32(approximateTokens(chunk)),
			searchTokens: searchTokens,
			metadata:     "{}",
		})
		if !vectorEnabled || s.models == nil {
			continue
		}
		result, embedErr := s.models.EmbedText(ctx, modelID, chunk)
		if embedErr != nil {
			if vectorErr == nil {
				vectorErr = embedErr
			}
			learned[index].metadata = vectorErrorMetadata(embedErr)
			continue
		}
		if len(result.Vector) != dimension {
			if vectorErr == nil {
				vectorErr = fmt.Errorf("向量维度不匹配: 配置 %d，实际 %d", dimension, len(result.Vector))
			}
			learned[index].metadata = vectorErrorMetadata(vectorErr)
			continue
		}
		vector, formatErr := formatVector(result.Vector)
		if formatErr != nil {
			if vectorErr == nil {
				vectorErr = formatErr
			}
			learned[index].metadata = vectorErrorMetadata(formatErr)
			continue
		}
		learned[index].embedding = &vector
		learned[index].embeddingModelID = &modelID
	}

	tx, err = s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, id)
	queries = sqlc.New(tx)
	current, err := lockDocument(ctx, queries, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errDocumentChanged
	}
	if err != nil {
		return err
	}
	if objectInt64(current["revision"]) != objectInt64(document["revision"]) {
		return errDocumentChanged
	}
	if !learningJobRevisionMatches(current, job) {
		return errDocumentChanged
	}
	if err = s.checkLearningJob(ctx, queries, job); err != nil {
		return err
	}
	binding, err := resource.DecodeObject(queries.GetKbResource(ctx, document.String("kb_id")))
	if err != nil {
		return err
	}
	if !learningJobTargetMatches(binding, modelID, dimension) {
		return errLearningJobCanceled
	}

	if err = queries.DeleteKbChunksByDocument(ctx, id); err != nil {
		return err
	}
	for index, chunk := range learned {
		tokens := chunk.tokens
		if err = queries.InsertKbChunk(ctx, sqlc.InsertKbChunkParams{
			KbID:             document.String("kb_id"),
			DocumentID:       id,
			ChunkIndex:       int32(index),
			Content:          chunk.content,
			TokenCount:       &tokens,
			SearchTokens:     chunk.searchTokens,
			Embedding:        chunk.embedding,
			EmbeddingModelID: chunk.embeddingModelID,
			Metadata:         chunk.metadata,
		}); err != nil {
			return err
		}
	}
	if vectorErr != nil {
		message := errorMessage(vectorErr)
		if err = queries.MarkKbDocumentVectorFailed(ctx, sqlc.MarkKbDocumentVectorFailedParams{
			ID:           id,
			ErrorMessage: &message,
			ChunkCount:   int32(len(learned)),
		}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err = queries.FinishKbDocumentLearning(ctx, sqlc.FinishKbDocumentLearningParams{
		ID:         id,
		ChunkCount: int32(len(learned)),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// rebuildDocumentVector completes only missing or stale vectors for a document
// that already has chunks. Successful chunks are retained when a later chunk
// fails, so retry only processes the remaining chunks.
func (s *Service) rebuildDocumentVector(ctx context.Context, id string, job sqlc.ClaimKbLearningJobRow) error {
	modelID, dimension := learningJobTarget(job)
	if modelID == "" || dimension <= 0 {
		return errLearningJobCanceled
	}
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, id)
	queries := sqlc.New(tx)
	document, err := lockDocument(ctx, queries, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errDocumentChanged
	}
	if err != nil {
		return err
	}
	if !documentHasChunks(document) || !learningJobRevisionMatches(document, job) {
		return errDocumentChanged
	}
	if err = s.checkLearningJob(ctx, queries, job); err != nil {
		return err
	}
	binding, err := resource.DecodeObject(queries.GetKbResource(ctx, document.String("kb_id")))
	if err != nil {
		return err
	}
	if !learningJobTargetMatches(binding, modelID, dimension) {
		return errLearningJobCanceled
	}
	kbID := document.String("kb_id")
	chunkCount := int32(objectInt64(document["chunk_count"]))
	if err = tx.Commit(ctx); err != nil {
		return err
	}

	rows, err := sqlc.New(s.store.Pool).ListKbChunksNeedingVector(ctx, sqlc.ListKbChunksNeedingVectorParams{
		KbID: kbID, DocumentID: id, EmbeddingModelID: modelID,
	})
	if err != nil {
		return err
	}
	vectors := make([]rebuiltVector, 0, len(rows))
	var vectorErr error
	for _, row := range rows {
		if s.models == nil {
			vectorErr = resource.InvalidCode("vector_unavailable", "向量模型服务不可用")
			break
		}
		result, embedErr := s.models.EmbedText(ctx, modelID, row.Content)
		if embedErr != nil {
			if vectorErr == nil {
				vectorErr = embedErr
			}
			continue
		}
		if len(result.Vector) != dimension {
			if vectorErr == nil {
				vectorErr = fmt.Errorf("向量维度不匹配: 配置 %d，实际 %d", dimension, len(result.Vector))
			}
			continue
		}
		vector, formatErr := formatVector(result.Vector)
		if formatErr != nil {
			if vectorErr == nil {
				vectorErr = formatErr
			}
			continue
		}
		vectors = append(vectors, rebuiltVector{id: row.ID, embedding: vector, metadata: "{}"})
	}

	tx, err = s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, id)
	queries = sqlc.New(tx)
	current, err := lockDocument(ctx, queries, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return errDocumentChanged
	}
	if err != nil {
		return err
	}
	if !documentHasChunks(current) || !learningJobRevisionMatches(current, job) {
		return errDocumentChanged
	}
	if err = s.checkLearningJob(ctx, queries, job); err != nil {
		return err
	}
	binding, err = resource.DecodeObject(queries.GetKbResource(ctx, kbID))
	if err != nil {
		return err
	}
	if !learningJobTargetMatches(binding, modelID, dimension) {
		return errLearningJobCanceled
	}
	if err = s.applyVectors(ctx, queries, modelID, vectors); err != nil {
		return err
	}
	if vectorErr != nil {
		message := errorMessage(vectorErr)
		if err = queries.MarkKbDocumentVectorFailed(ctx, sqlc.MarkKbDocumentVectorFailedParams{
			ID:           id,
			ErrorMessage: &message,
			ChunkCount:   chunkCount,
		}); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	if err = queries.FinishKbDocumentVectorLearning(ctx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func errorMessage(err error) string {
	message := []rune(err.Error())
	return string(message[:min(2000, len(message))])
}

func vectorErrorMetadata(err error) string {
	message := []rune(err.Error())
	message = message[:min(500, len(message))]
	data, marshalErr := json.Marshal(map[string]string{"vector_error": string(message)})
	if marshalErr != nil {
		return "{}"
	}
	return string(data)
}

func (s *Service) failLearningDocument(ctx context.Context, document resource.Object, job sqlc.ClaimKbLearningJobRow, cause error) error {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, document.String("id"))
	queries := sqlc.New(tx)
	current, err := lockDocument(ctx, queries, document.String("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if objectInt64(current["revision"]) != objectInt64(document["revision"]) || !learningJobRevisionMatches(current, job) {
		return nil
	}
	if err = s.checkLearningJob(ctx, queries, job); errors.Is(err, errLearningJobCanceled) {
		return nil
	} else if err != nil {
		return err
	}
	text := errorMessage(cause)
	if err = queries.MarkKbDocumentFailed(ctx, sqlc.MarkKbDocumentFailedParams{ID: document.String("id"), ErrorMessage: &text}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
