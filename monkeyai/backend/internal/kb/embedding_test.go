package kb

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedEmbeddingModel(t *testing.T, pool *pgxpool.Pool, actor, id string) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `INSERT INTO models
		(id, ownership_type, owner_user_id, model_id, display_name, protocol, base_url,
		 api_key, advanced_config, kind, provider, embedding_config)
		VALUES ($1, 'system', $2, 'embedding', 'Embedding', 'openai_embeddings',
		 'https://example.com/v1', 'test', '{}', 'embedding', 'passthrough', '{"dimension":3}')`, id, actor)
	if err != nil {
		t.Fatal(err)
	}
}

func TestAutomaticEmbeddingModel(t *testing.T) {
	pool, actor := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil)
	ctx := t.Context()
	create := func() resource.Object {
		t.Helper()
		item, err := s.CRUD.Save(ctx, actor, "", "", resource.Object{"name": "automatic"})
		if err != nil {
			t.Fatal(err)
		}
		return item
	}
	item := create()
	if item.String("embedding_model_id") != "" {
		t.Fatal("没有可用 embedding 时应仅使用全文检索")
	}
	first, second := resource.ID(), resource.ID()
	seedEmbeddingModel(t, pool, actor, first)
	created := create()
	if created.String("embedding_model_id") != first || objectInt64(created["embedding_dimension"]) != 3 {
		t.Fatalf("创建时未自动选择 embedding: %v", created)
	}
	seedEmbeddingModel(t, pool, actor, second)
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, item.String("id"), first, 3)
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, item.String("id"), first, 3)

	if _, err := pool.Exec(ctx, `UPDATE models SET enabled=false WHERE id=$1`, first); err != nil {
		t.Fatal(err)
	}
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, item.String("id"), first, 0)

	if _, err := pool.Exec(ctx, `UPDATE models SET enabled=true WHERE id=$1`, first); err != nil {
		t.Fatal(err)
	}
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, item.String("id"), first, 3)

	current, err := s.Get(ctx, item.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SwitchEmbeddingModel(ctx, item.String("id"), second, fmt.Sprintf(`"%v"`, current["revision"])); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, item.String("id"), second, 3)

	if _, err := pool.Exec(ctx, `UPDATE models SET enabled=false WHERE id=$1`, second); err != nil {
		t.Fatal(err)
	}
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, item.String("id"), second, 0)
	current, err = s.Get(ctx, item.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	unbound, err := s.SwitchEmbeddingModel(ctx, item.String("id"), "", fmt.Sprintf(`"%v"`, current["revision"]))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(unbound.String("notice"), "自动绑定") {
		t.Fatalf("解绑提示未说明后续自动绑定: %v", unbound)
	}
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, item.String("id"), first, 3)
}

func assertEmbeddingBinding(t *testing.T, s *Service, id, modelID string, dimension int) {
	t.Helper()
	item, err := s.Get(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	if item.String("embedding_model_id") != modelID || int(objectInt64(item["embedding_dimension"])) != dimension {
		t.Fatalf("binding = model:%q dimension:%v, want %q/%d: %v", item.String("embedding_model_id"), item["embedding_dimension"], modelID, dimension, item)
	}
}

func TestHistoricalDocumentsBackfillWhenEmbeddingModelAppears(t *testing.T) {
	pool, actor := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil)
	ctx := t.Context()
	kb, err := s.CRUD.Save(ctx, actor, "", "", resource.Object{"name": "历史知识库"})
	if err != nil {
		t.Fatal(err)
	}
	document, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: kb.String("id"), Title: "历史文档", Content: "历史知识库文档"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	document, err = s.GetDocument(ctx, document.String("id"))
	if err != nil || document.String("status") != "learned" || objectInt64(document["chunk_count"]) != 1 {
		t.Fatalf("无模型时未完成全文学习: %v, %v", document, err)
	}
	chunks, err := s.ListChunks(ctx, document.String("id"))
	if err != nil || len(chunks) != 1 || chunks[0].Bool("has_vector") {
		t.Fatalf("无模型学习结果异常: %v, %v", chunks, err)
	}

	modelID := resource.ID()
	seedEmbeddingModel(t, pool, actor, modelID)
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	assertEmbeddingBinding(t, s, kb.String("id"), modelID, 3)
	document, err = s.GetDocument(ctx, document.String("id"))
	if err != nil || document.String("status") != "learning" {
		t.Fatalf("模型出现后文档未进入学习中: %v, %v", document, err)
	}
	var operation string
	var documentID, embeddingModelID *string
	var documentRevision *int32
	if err := pool.QueryRow(ctx, `SELECT operation, document_id::text, document_revision, embedding_model_id::text
		FROM knowledge_base_learning_jobs
		WHERE kb_id=$1 AND status='pending'
		ORDER BY created_at DESC LIMIT 1`, kb.String("id")).Scan(&operation, &documentID, &documentRevision, &embeddingModelID); err != nil {
		t.Fatal(err)
	}
	if operation != OperationRebuildVector || documentID == nil || *documentID != document.String("id") ||
		embeddingModelID == nil || *embeddingModelID != modelID || documentRevision == nil ||
		int(*documentRevision) != int(objectInt64(document["revision"])) {
		t.Fatalf("历史文档补建任务缺少版本或模型快照: operation=%s document=%v revision=%v model=%v", operation, documentID, documentRevision, embeddingModelID)
	}
	chunksBefore, err := s.ListChunks(ctx, document.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		calls++
		return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
	})
	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	document, err = s.GetDocument(ctx, document.String("id"))
	if err != nil || document.String("status") != "learned" {
		t.Fatalf("向量补建后未恢复已学习: %v, %v", document, err)
	}
	chunksAfter, err := s.ListChunks(ctx, document.String("id"))
	if err != nil || len(chunksAfter) != 1 || !chunksAfter[0].Bool("has_vector") || calls != 1 {
		t.Fatalf("补建结果异常: chunks=%v calls=%d err=%v", chunksAfter, calls, err)
	}
	if chunksAfter[0].String("content") != chunksBefore[0].String("content") {
		t.Fatal("补建向量不应重新切分或改变分片内容")
	}
}

func TestVectorFailureKeepsLexicalAndRetryOnlyFillsMissingChunks(t *testing.T) {
	pool, actor := kbTestPool(t)
	modelID := resource.ID()
	seedEmbeddingModel(t, pool, actor, modelID)
	s := NewService(resource.NewStore(pool), nil)
	ctx := t.Context()
	kb, err := s.CRUD.Save(ctx, actor, "", "", resource.Object{"name": "向量失败"})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		calls++
		if calls == 2 {
			return model.EmbeddingResult{}, errors.New("upstream vector failure")
		}
		return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
	})
	document, err := s.CreateDocument(ctx, actor, DocumentInput{
		KbID: kb.String("id"), Title: "长文档", Content: strings.Repeat("知识", (chunkRunes+overlapRunes)/2),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	document, err = s.GetDocument(ctx, document.String("id"))
	if err != nil || document.String("status") != "failed" || objectInt64(document["chunk_count"]) != 2 || document.String("error_message") == "" {
		t.Fatalf("向量失败后状态异常: %v, %v", document, err)
	}
	chunks, err := s.ListChunks(ctx, document.String("id"))
	if err != nil || len(chunks) != 2 || !chunks[0].Bool("has_vector") || chunks[1].Bool("has_vector") {
		t.Fatalf("向量失败分片结果异常: %v, %v", chunks, err)
	}
	ranked, err := sqlc.New(pool).SearchKbChunksLexical(ctx, sqlc.SearchKbChunksLexicalParams{
		KbID: kb.String("id"), QueryExpression: strings.Join(strings.Fields(tokenizeText("知识")), " | "), RowLimit: 10,
	})
	items, decodeErr := resource.DecodeObjects(ranked, nil)
	if err != nil || decodeErr != nil || len(items) == 0 {
		t.Fatalf("向量失败期间全文检索不可用: items=%v err=%v/%v", items, err, decodeErr)
	}

	retryCalls := 0
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		retryCalls++
		return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
	})
	document, err = s.RestudyDocument(ctx, document.String("id"))
	if err != nil || document.String("status") != "learning" {
		t.Fatalf("重试未进入学习中: %v, %v", document, err)
	}
	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	document, err = s.GetDocument(ctx, document.String("id"))
	if err != nil || document.String("status") != "learned" {
		t.Fatalf("补齐向量后未恢复已学习: %v, %v", document, err)
	}
	if retryCalls != 1 {
		t.Fatalf("重试应只补齐缺失分片，实际调用 %d 次", retryCalls)
	}
}

func TestDisablingEmbeddingPreservesVectorFailedDocumentState(t *testing.T) {
	pool, actor := kbTestPool(t)
	modelID := resource.ID()
	seedEmbeddingModel(t, pool, actor, modelID)
	s := NewService(resource.NewStore(pool), nil)
	ctx := t.Context()
	kb, err := s.CRUD.Save(ctx, actor, "", "", resource.Object{"name": "失败后解绑"})
	if err != nil {
		t.Fatal(err)
	}
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		return model.EmbeddingResult{}, errors.New("upstream vector failure")
	})
	document, err := s.CreateDocument(ctx, actor, DocumentInput{
		KbID: kb.String("id"), Title: "向量失败文档", Content: "需要保留全文检索",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, `UPDATE models SET enabled=false WHERE id=$1`, modelID); err != nil {
		t.Fatal(err)
	}
	if err := s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	document, err = s.GetDocument(ctx, document.String("id"))
	if err != nil || document.String("status") != "failed" || objectInt64(document["chunk_count"]) != 1 {
		t.Fatalf("禁用模型后失败文档状态被改写: %v, %v", document, err)
	}
	assertEmbeddingBinding(t, s, kb.String("id"), modelID, 0)
}

func TestDocumentMetadataUpdateKeepsIndex(t *testing.T) {
	pool, actor := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil)
	ctx := t.Context()
	kb, err := s.CRUD.Save(ctx, actor, "", "", resource.Object{"name": "元数据更新"})
	if err != nil {
		t.Fatal(err)
	}
	document, err := s.CreateDocument(ctx, actor, DocumentInput{
		KbID: kb.String("id"), Title: "原标题", Content: "保留的正文",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	before, err := s.GetDocument(ctx, document.String("id"))
	if err != nil {
		t.Fatal(err)
	}

	updated, err := s.UpdateDocument(ctx, document.String("id"), DocumentInput{Title: "新标题"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.String("title") != "新标题" || updated.String("content") != "保留的正文" ||
		updated.String("status") != "learned" || objectInt64(updated["chunk_count"]) != 1 ||
		objectInt64(updated["revision"]) != objectInt64(before["revision"])+1 {
		t.Fatalf("只更新标题不应使索引失效: before=%v after=%v", before, updated)
	}
	chunks, err := s.ListChunks(ctx, document.String("id"))
	if err != nil || len(chunks) != 1 {
		t.Fatalf("只更新标题不应删除分片: %v, %v", chunks, err)
	}
	var activeJobs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_learning_jobs
		WHERE document_id=$1 AND status IN ('pending', 'running')`, document.String("id")).Scan(&activeJobs); err != nil || activeJobs != 0 {
		t.Fatalf("只更新标题不应创建学习任务: active=%d err=%v", activeJobs, err)
	}
}

func TestDocumentContentUpdateInvalidatesBothIndexes(t *testing.T) {
	pool, actor := kbTestPool(t)
	modelID := resource.ID()
	seedEmbeddingModel(t, pool, actor, modelID)
	s := NewService(resource.NewStore(pool), nil)
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
	})
	ctx := t.Context()
	kb, err := s.CRUD.Save(ctx, actor, "", "", resource.Object{"name": "正文更新"})
	if err != nil {
		t.Fatal(err)
	}
	document, err := s.CreateDocument(ctx, actor, DocumentInput{
		KbID: kb.String("id"), Title: "正文更新文档", Content: "苹果香蕉",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	chunks, err := s.ListChunks(ctx, document.String("id"))
	if err != nil || len(chunks) != 1 || !chunks[0].Bool("has_vector") {
		t.Fatalf("初始索引异常: %v, %v", chunks, err)
	}

	updated, err := s.UpdateDocument(ctx, document.String("id"), DocumentInput{Content: "汽车火车"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.String("status") != "pending" || objectInt64(updated["chunk_count"]) != 0 {
		t.Fatalf("正文更新后未进入待学习: %v", updated)
	}
	chunks, err = s.ListChunks(ctx, document.String("id"))
	if err != nil || len(chunks) != 0 {
		t.Fatalf("正文更新后旧分片未删除: %v, %v", chunks, err)
	}
	if count := lexicalSearchCount(t, pool, kb.String("id"), "苹果"); count != 0 {
		t.Fatalf("正文更新后仍能搜到旧全文索引: %d", count)
	}
	var operation string
	if err := pool.QueryRow(ctx, `SELECT operation FROM knowledge_base_learning_jobs
		WHERE document_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`, document.String("id")).Scan(&operation); err != nil {
		t.Fatal(err)
	}
	if operation != OperationRelearn {
		t.Fatalf("正文更新后任务类型 = %s, want %s", operation, OperationRelearn)
	}

	if _, err := s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	chunks, err = s.ListChunks(ctx, document.String("id"))
	if err != nil || len(chunks) != 1 || chunks[0].String("content") != "汽车火车" || !chunks[0].Bool("has_vector") {
		t.Fatalf("正文更新后索引未重建: %v, %v", chunks, err)
	}
	if count := lexicalSearchCount(t, pool, kb.String("id"), "苹果"); count != 0 {
		t.Fatalf("正文更新后仍能搜到旧内容: %d", count)
	}
	if count := lexicalSearchCount(t, pool, kb.String("id"), "汽车"); count != 1 {
		t.Fatalf("正文更新后无法搜到新内容: %d", count)
	}
}

func lexicalSearchCount(t *testing.T, pool *pgxpool.Pool, kbID, query string) int {
	t.Helper()
	raw, err := sqlc.New(pool).SearchKbChunksLexical(t.Context(), sqlc.SearchKbChunksLexicalParams{
		KbID: kbID, QueryExpression: strings.Join(strings.Fields(tokenizeText(query)), " | "), RowLimit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	items, err := resource.DecodeObjects(raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	return len(items)
}
