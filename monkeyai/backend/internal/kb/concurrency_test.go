package kb

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type callbackEmbedder func(context.Context, string, string) (model.EmbeddingResult, error)

func (f callbackEmbedder) EmbedText(ctx context.Context, modelID, input string) (model.EmbeddingResult, error) {
	return f(ctx, modelID, input)
}

func seedLearningKB(t *testing.T, pool *pgxpool.Pool, actor, operation, status string) (*Service, string, string) {
	t.Helper()
	s := NewService(resource.NewStore(pool), nil)
	kbID, docID, modelID := resource.ID(), resource.ID(), resource.ID()
	seedEmbeddingModel(t, pool, actor, modelID)
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO kb(id,name,owner_user_id,created_by_user_id,embedding_model_id,embedding_dimension) VALUES($1,'regression',$2,$2,$3,3)`, []any{kbID, actor, modelID}},
		{`INSERT INTO kb_documents(id,kb_id,title,content,status,chunk_count,created_by_user_id) VALUES($1,$2,'document','old content',$3,CASE WHEN $3='learned' THEN 1 ELSE 0 END,$4)`, []any{docID, kbID, status, actor}},
		{`INSERT INTO kb_learning_jobs(kb_id,operation,document_revision,embedding_model_id,embedding_dimension)
			SELECT $1,$2,d.revision,$3,3 FROM kb_documents d WHERE d.id=$4`, []any{kbID, operation, modelID, docID}},
	} {
		if _, err := pool.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	return s, kbID, docID
}

func TestLearningWritebackRejectsChangedDocument(t *testing.T) {
	for _, mutation := range []string{"delete", "update"} {
		t.Run(mutation, func(t *testing.T) {
			pool, actor := kbTestPool(t)
			s, _, docID := seedLearningKB(t, pool, actor, OperationRebuildParse, "pending")
			s.models = callbackEmbedder(func(ctx context.Context, _, _ string) (model.EmbeddingResult, error) {
				if mutation == "delete" {
					if err := s.DeleteDocument(ctx, docID); err != nil {
						t.Fatal(err)
					}
				} else if _, err := s.UpdateDocument(ctx, docID, DocumentInput{Content: "new content"}); err != nil {
					t.Fatal(err)
				}
				return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
			})
			if worked, err := s.runLearningJob(t.Context()); err != nil || !worked {
				t.Fatalf("worked=%v err=%v", worked, err)
			}
			var chunks int
			if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM kb_chunks WHERE document_id=$1`, docID).Scan(&chunks); err != nil || chunks != 0 {
				t.Fatalf("stale chunks=%d err=%v", chunks, err)
			}
			if mutation == "update" {
				item, err := s.GetDocument(t.Context(), docID)
				if err != nil || item.String("content") != "new content" || item.String("status") != "pending" {
					t.Fatalf("updated document overwritten: %v, %v", item, err)
				}
				s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
					return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
				})
				if _, err := s.runLearningJob(t.Context()); err != nil {
					t.Fatal(err)
				}
				items, err := s.ListChunks(t.Context(), docID)
				if err != nil || len(items) != 1 || items[0].String("content") != "new content" {
					t.Fatalf("new content was not learned: %v, %v", items, err)
				}
			}
		})
	}
}

func TestCanceledVectorRebuildCannotRestoreVectors(t *testing.T) {
	pool, actor := kbTestPool(t)
	s, kbID, docID := seedLearningKB(t, pool, actor, OperationRebuildVector, "learned")
	if _, err := pool.Exec(t.Context(), `INSERT INTO kb_chunks(kb_id,document_id,chunk_index,content,embedding) VALUES($1,$2,0,'old content','[1,2,3]')`, kbID, docID); err != nil {
		t.Fatal(err)
	}
	s.models = callbackEmbedder(func(ctx context.Context, _, _ string) (model.EmbeddingResult, error) {
		if _, err := s.SwitchEmbeddingModel(ctx, kbID, "", `"1"`); err != nil {
			t.Fatal(err)
		}
		return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
	})
	if _, err := s.runLearningJob(t.Context()); err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	id, worker := mustJobID(t, pool, kbID), s.workerID()
	if err := queries.FinishKbLearningJob(t.Context(), sqlc.FinishKbLearningJobParams{ID: id, Attempts: 1, WorkerID: &worker}); err != nil {
		t.Fatal(err)
	}
	message := "late failure after cancellation"
	if err := queries.FailKbLearningJob(t.Context(), sqlc.FailKbLearningJobParams{ID: id, Attempts: 1, WorkerID: &worker, ErrorMessage: &message}); err != nil {
		t.Fatal(err)
	}
	var vectors int
	var status string
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM kb_chunks WHERE kb_id=$1 AND embedding IS NOT NULL`, kbID).Scan(&vectors); err != nil || vectors != 0 {
		t.Fatalf("vectors restored after unbind: %d, %v", vectors, err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT status FROM kb_learning_jobs WHERE kb_id=$1`, kbID).Scan(&status); err != nil || status != "canceled" {
		t.Fatalf("canceled job overwritten: %s, %v", status, err)
	}
}

func TestLearningFailureMarksCurrentDocument(t *testing.T) {
	pool, actor := kbTestPool(t)
	s, _, docID := seedLearningKB(t, pool, actor, OperationLearn, "pending")
	if _, err := pool.Exec(t.Context(), `UPDATE kb_documents SET content='!!!' WHERE id=$1`, docID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.runLearningJob(t.Context()); err == nil {
		t.Fatal("unsearchable content should fail learning")
	}
	item, err := s.GetDocument(t.Context(), docID)
	if err != nil || item.String("status") != "failed" || item.String("error_message") == "" {
		t.Fatalf("learning error was not recorded: %v, %v", item, err)
	}
}

func TestMaintenanceResumesUnfinishedLearning(t *testing.T) {
	for _, operation := range []string{OperationRebuildLexical, OperationRebuildVector, "unbind"} {
		t.Run(operation, func(t *testing.T) {
			pool, actor := kbTestPool(t)
			s, kbID, docID := seedLearningKB(t, pool, actor, OperationLearn, "learning")
			if operation == "unbind" {
				if _, err := s.SwitchEmbeddingModel(t.Context(), kbID, "", `"1"`); err != nil {
					t.Fatal(err)
				}
			} else if _, err := s.RebuildIndex(t.Context(), kbID, operation, "", ""); err != nil {
				t.Fatal(err)
			}
			s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
				return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
			})
			for range 2 {
				if _, err := s.runLearningJob(t.Context()); err != nil {
					t.Fatal(err)
				}
			}
			item, err := s.GetDocument(t.Context(), docID)
			if err != nil || item.String("status") != "learned" {
				t.Fatalf("unfinished document stranded: %v, %v", item, err)
			}
		})
	}
}

func TestLearningLeaseFencesPreviousAttempt(t *testing.T) {
	pool, actor := kbTestPool(t)
	s, kbID, docID := seedLearningKB(t, pool, actor, OperationLearn, "pending")
	s.models = callbackEmbedder(func(ctx context.Context, _, _ string) (model.EmbeddingResult, error) {
		if _, err := pool.Exec(ctx, `UPDATE kb_learning_jobs SET attempts=attempts+1,locked_by='replacement' WHERE kb_id=$1`, kbID); err != nil {
			t.Fatal(err)
		}
		return model.EmbeddingResult{Vector: []float64{1, 2, 3}}, nil
	})
	if _, err := s.runLearningJob(t.Context()); err != nil {
		t.Fatal(err)
	}
	var status, owner string
	if err := pool.QueryRow(t.Context(), `SELECT status,locked_by FROM kb_learning_jobs WHERE kb_id=$1`, kbID).Scan(&status, &owner); err != nil || status != "running" || owner != "replacement" {
		t.Fatalf("replacement lease overwritten: %s %s %v", status, owner, err)
	}
	items, err := s.ListChunks(t.Context(), docID)
	if err != nil || len(items) != 0 {
		t.Fatalf("previous attempt wrote chunks: %v, %v", items, err)
	}
	queries := sqlc.New(pool)
	message := "late failure"
	if err := queries.FailKbLearningJob(t.Context(), sqlc.FailKbLearningJobParams{ID: mustJobID(t, pool, kbID), Attempts: 1, WorkerID: optionalString(s.workerID()), ErrorMessage: &message}); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `SELECT status FROM kb_learning_jobs WHERE kb_id=$1`, kbID).Scan(&status); err != nil || status != "running" {
		t.Fatalf("previous attempt failed replacement: %s %v", status, err)
	}
}

func mustJobID(t *testing.T, pool *pgxpool.Pool, kbID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(t.Context(), `SELECT id::text FROM kb_learning_jobs WHERE kb_id=$1`, kbID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestAdminPersonalKBWriteRoutesAreReadOnly(t *testing.T) {
	pool, actor := kbTestPool(t)
	s, kbID, docID := seedLearningKB(t, pool, actor, OperationLearn, "pending")
	if _, err := pool.Exec(t.Context(), `UPDATE kb SET ownership_type='user' WHERE id=$1`, kbID); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	for _, call := range []struct{ method, path, body string }{
		{"POST", "/documents", `{"title":"injected","content":"injected"}`},
		{"PUT", "/documents/" + docID, `{"content":"overwritten"}`},
		{"DELETE", "/documents/" + docID, ""},
		{"POST", "/documents/" + docID + "/retry", ""},
		{"POST", "/embedding-model/switch", `{"embedding_model_id":null}`},
		{"POST", "/index/rebuild", `{"operation":"rebuild_parse"}`},
	} {
		t.Run(call.method+call.path, func(t *testing.T) {
			r := httptest.NewRequest(call.method, "/kb/"+kbID+call.path, strings.NewReader(call.body))
			r.Header.Set("If-Match", `"1"`)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
	item, err := s.GetDocument(t.Context(), docID)
	if err != nil || item.String("content") != "old content" || item.String("status") != "pending" {
		t.Fatalf("personal document mutated: %v, %v", item, err)
	}
	item, err = s.Get(t.Context(), kbID)
	if err != nil || fmt.Sprint(item["revision"]) != "1" {
		t.Fatalf("personal KB mutated: %v, %v", item, err)
	}
}
