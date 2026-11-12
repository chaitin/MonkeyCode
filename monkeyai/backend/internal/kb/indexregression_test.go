package kb

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestKnowledgeBaseIndexAndTreeRegressions(t *testing.T) {
	t.Run("folders_are_not_learning_documents", func(t *testing.T) {
		pool, actor, s, createKB := indexRegressionFixture(t)
		ctx := t.Context()

		id := createKB()
		folder, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "folder", NodeType: "folder"})
		if err != nil {
			t.Fatal(err)
		}
		if err = s.scheduleIndexJob(ctx, id, OperationRebuildLexical); err != nil {
			t.Fatal(err)
		}
		var n int
		if err = reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id=$1", folder.String("id")).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("folder incorrectly queued for learning: %d jobs", n)
		}
		mid := resource.ID()
		seedEmbeddingModel(t, pool, actor, mid)
		if err := s.SyncEmbeddingModels(ctx); err != nil {
			t.Fatal(err)
		}
		reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id=$1", folder.String("id")).Scan(&n)
		if n != 0 {
			t.Fatalf("model binding queued folder: %d jobs", n)
		}
		if _, err := s.RestudyDocument(ctx, folder.String("id")); err == nil {
			t.Fatal("folder restudy should be rejected")
		}

		reviewExec(t, pool, ctx, "DELETE FROM knowledge_base_learning_jobs WHERE kb_id=$1", id)
	})
	t.Run("parse_rebuild_handles_nested_documents", func(t *testing.T) {
		pool, actor, s, createKB := indexRegressionFixture(t)
		ctx := t.Context()

		id := createKB()
		folder, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "folder", NodeType: "folder"})
		if err != nil {
			t.Fatal(err)
		}
		parent := folder.String("id")
		doc, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "child", Content: "valid content", ParentID: &parent})
		if err != nil {
			t.Fatal(err)
		}
		if err = s.scheduleIndexJob(ctx, id, OperationRebuildParse); err != nil {
			t.Fatal(err)
		}
		_, runErr := s.runLearningJob(ctx)
		var chunks int
		reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_chunks WHERE document_id=$1", doc.String("id")).Scan(&chunks)
		if runErr != nil {
			t.Fatal(runErr)
		}
		if chunks != 1 {
			t.Errorf("child has no chunks after rebuild; worker error=%v", runErr)
		}
		reviewExec(t, pool, ctx, "DELETE FROM knowledge_base_learning_jobs WHERE kb_id=$1", id)
	})
	t.Run("parse_rebuild_preserves_vectors", func(t *testing.T) {
		pool, actor, s, createKB := indexRegressionFixture(t)
		ctx := t.Context()

		mid := resource.ID()
		seedEmbeddingModel(t, pool, actor, mid)
		id := createKB()
		doc, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "doc", Content: "valid text"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.runLearningJob(ctx); err != nil {
			t.Fatal(err)
		}
		var before, after int
		reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_chunks WHERE document_id=$1 AND embedding IS NOT NULL", doc.String("id")).Scan(&before)
		if err = s.scheduleIndexJob(ctx, id, OperationRebuildParse); err != nil {
			t.Fatal(err)
		}
		if _, err = s.runLearningJob(ctx); err != nil {
			t.Fatal(err)
		}
		reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_chunks WHERE document_id=$1 AND embedding IS NOT NULL", doc.String("id")).Scan(&after)
		if before != 1 || after != 1 {
			t.Errorf("vectors before=%d after=%d", before, after)
		}
		reviewExec(t, pool, ctx, "DELETE FROM knowledge_base_learning_jobs WHERE kb_id=$1", id)
	})
	t.Run("failed_job_retry_is_not_successful_noop", func(t *testing.T) {
		pool, actor, s, createKB := indexRegressionFixture(t)
		ctx := t.Context()

		id := createKB()
		doc, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "doc", Content: "!!!"})
		if err != nil {
			t.Fatal(err)
		}
		_, err = s.runLearningJob(ctx)
		if err == nil {
			t.Fatal("expected first failure")
		}
		reviewExec(t, pool, ctx, "UPDATE knowledge_base_learning_jobs SET available_at=now() WHERE kb_id=$1", id)
		if _, err = s.runLearningJob(ctx); err == nil {
			t.Fatal("retry must execute and fail again")
		}
		reviewExec(t, pool, ctx, "UPDATE knowledge_base_learning_jobs SET available_at=now() WHERE kb_id=$1", id)
		if _, err = s.runLearningJob(ctx); err == nil {
			t.Fatal("last attempt must execute")
		}
		var jobStatus, docStatus string
		reviewQuery(t, pool, ctx, "SELECT status FROM knowledge_base_learning_jobs WHERE kb_id=$1", id).Scan(&jobStatus)
		reviewQuery(t, pool, ctx, "SELECT status FROM knowledge_base_documents WHERE id=$1", doc.String("id")).Scan(&docStatus)
		if jobStatus != "failed" {
			t.Errorf("retry falsely succeeded while document status=%s", docStatus)
		}
	})
	t.Run("batch_move_rechecks_ancestry_after_lock", func(t *testing.T) {
		pool, actor, s, createKB := indexRegressionFixture(t)
		ctx := t.Context()

		id := createKB()
		a, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "A", NodeType: "folder"})
		if err != nil {
			t.Fatal(err)
		}
		b, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "B", NodeType: "folder"})
		if err != nil {
			t.Fatal(err)
		}
		aid, bid := a.String("id"), b.String("id")
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, "SELECT id FROM knowledge_bases WHERE id=$1 FOR UPDATE", id); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() {
			_, e := s.BatchDocuments(ctx, id, BatchDocumentInput{Action: "move", IDs: []string{aid}, ParentID: &bid})
			done <- e
		}()
		waiting := false
		for i := 0; i < 100; i++ {
			reviewQuery(t, pool, ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM knowledge_bases t%' AND pid<>pg_backend_pid())").Scan(&waiting)
			if waiting {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !waiting {
			t.Fatal("batch did not reach lock wait")
		}
		if _, err = tx.Exec(ctx, "UPDATE knowledge_base_documents SET parent_id=$1 WHERE id=$2", aid, bid); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err = <-done; err != nil {
			t.Fatal(err)
		}
		tree, err := s.ListDocuments(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if len(tree) == 0 {
			t.Error("concurrent moves produced A -> B -> A; both folders vanished from tree")
		}
	})

	t.Run("switch_to_new_model_invalidates_vectors", func(t *testing.T) {
		pool, actor, s, createKB := indexRegressionFixture(t)
		ctx := t.Context()

		mid := resource.ID()
		seedEmbeddingModel(t, pool, actor, mid)
		id := createKB()
		doc, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "doc", Content: "valid text"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.runLearningJob(ctx); err != nil {
			t.Fatal(err)
		}
		next := resource.ID()
		seedEmbeddingModel(t, pool, actor, next)
		current, err := s.Get(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.SwitchEmbeddingModel(ctx, id, next, fmt.Sprintf(`"%v"`, current["revision"])); err != nil {
			t.Fatal(err)
		}
		var vectors, jobs int
		reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_chunks WHERE document_id=$1 AND embedding IS NOT NULL", doc.String("id")).Scan(&vectors)
		reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_learning_jobs WHERE kb_id=$1 AND status IN ('pending','running')", id).Scan(&jobs)
		if vectors != 0 || jobs != 1 {
			t.Errorf("changed upstream model, retained %d stale vectors and scheduled %d rebuild jobs", vectors, jobs)
		}
	})

}

func reviewExec(t *testing.T, pool *pgxpool.Pool, ctx context.Context, query string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, query, args...); err != nil {
		t.Fatal(err)
	}
}

type reviewRow struct {
	t    *testing.T
	scan func(...any) error
}

func (r reviewRow) Scan(dest ...any) error {
	r.t.Helper()
	err := r.scan(dest...)
	if err != nil {
		r.t.Fatal(err)
	}
	return err
}
func reviewQuery(t *testing.T, pool *pgxpool.Pool, ctx context.Context, query string, args ...any) reviewRow {
	t.Helper()
	return reviewRow{t: t, scan: pool.QueryRow(ctx, query, args...).Scan}
}

func indexRegressionFixture(t *testing.T) (*pgxpool.Pool, string, *Service, func() string) {
	t.Helper()
	pool, actor := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil)
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
	})
	create := func() string {
		t.Helper()
		item, err := s.CRUD.Save(t.Context(), actor, "", "", resource.Object{"name": "regression"})
		if err != nil {
			t.Fatal(err)
		}
		return item.String("id")
	}
	return pool, actor, s, create
}

func TestRebuildParseWithInactiveBindingUsesLexicalIndex(t *testing.T) {
	pool, actor, s, create := indexRegressionFixture(t)
	ctx := t.Context()
	mid := resource.ID()
	seedEmbeddingModel(t, pool, actor, mid)
	id := create()
	doc, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "document", Content: "searchable content"})
	if err != nil {
		t.Fatal(err)
	}
	reviewExec(t, pool, ctx, "UPDATE models SET enabled=false WHERE id=$1", mid)
	if err = s.SyncEmbeddingModels(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.scheduleIndexJob(ctx, id, OperationRebuildParse); err != nil {
		t.Fatal(err)
	}
	if _, err = s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	item, err := s.GetDocument(ctx, doc.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	if item.String("status") != "learned" || objectInt64(item["chunk_count"]) != 1 {
		t.Fatalf("document not learned: %v", item)
	}
}

func TestModelSwitchFencesInFlightLearning(t *testing.T) {
	pool, actor, s, create := indexRegressionFixture(t)
	ctx := t.Context()
	mid := resource.ID()
	seedEmbeddingModel(t, pool, actor, mid)
	id := create()
	doc, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: "document", Content: "searchable content"})
	if err != nil {
		t.Fatal(err)
	}
	s.models = callbackEmbedder(func(ctx context.Context, modelID, _ string) (model.EmbeddingResult, error) {
		next := resource.ID()
		seedEmbeddingModel(t, pool, actor, next)
		current, err := s.Get(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.SwitchEmbeddingModel(ctx, id, next, fmt.Sprintf(`"%v"`, current["revision"])); err != nil {
			t.Fatal(err)
		}
		return model.EmbeddingResult{Vector: []float64{1, 0, 0}}, nil
	})
	if _, err = s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	reviewQuery(t, pool, ctx, "SELECT count(*) FROM knowledge_base_chunks WHERE document_id=$1", doc.String("id")).Scan(&n)
	if n != 0 {
		t.Fatal("stale model wrote vectors after its job was canceled")
	}
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		return model.EmbeddingResult{Vector: []float64{0, 1, 0}}, nil
	})
	if _, err = s.runLearningJob(ctx); err != nil {
		t.Fatal(err)
	}
	var vector string
	reviewQuery(t, pool, ctx, "SELECT embedding::text FROM knowledge_base_chunks WHERE document_id=$1", doc.String("id")).Scan(&vector)
	if vector != "[0,1,0]" {
		t.Fatalf("new model vector=%s", vector)
	}
}
