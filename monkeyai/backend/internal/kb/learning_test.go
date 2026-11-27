package kb

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"strings"
	"testing"
)

func TestSplitContentUsesBoundedOverlappingChunks(t *testing.T) {
	content := strings.Repeat("知", chunkRunes*2+600)
	chunks := splitContent(content)
	if len(chunks) != 3 {
		t.Fatalf("分片数量 = %d，预期 3", len(chunks))
	}
	for i, chunk := range chunks {
		if size := len([]rune(chunk)); size == 0 || size > chunkRunes {
			t.Fatalf("第 %d 个分片长度无效: %d", i, size)
		}
	}
	if tail := []rune(chunks[0])[chunkRunes-overlapRunes:]; string(tail) != string([]rune(chunks[1])[:overlapRunes]) {
		t.Fatal("相邻分片未保留约定重叠")
	}
}

func TestSplitContentIgnoresBlankInput(t *testing.T) {
	if chunks := splitContent(" \n\t "); len(chunks) != 0 {
		t.Fatalf("空白内容产生分片: %#v", chunks)
	}
}

func TestLearningBlankDocumentSucceeds(t *testing.T) {
	for _, content := range []string{"", " \n\t ", "---\n| :---: | --- |\n***", strings.Repeat("-", chunkRunes*3)} {
		t.Run("content="+content, func(t *testing.T) {
			pool, actor := kbTestPool(t)
			ctx := t.Context()
			// Keep a vector binding but no model service: zero chunks need no embeddings.
			s, kbID, docID := seedLearningKB(t, pool, actor, OperationRelearn, "failed")
			if _, err := pool.Exec(ctx, `UPDATE knowledge_base_documents SET content=$2,chunk_count=1,error_message='previous failure' WHERE id=$1`, docID, content); err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_chunks(kb_id,document_id,chunk_index,content) VALUES($1,$2,0,'stale content')`, kbID, docID); err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `UPDATE knowledge_base_learning_jobs SET document_id=$2 WHERE kb_id=$1`, kbID, docID); err != nil {
				t.Fatal(err)
			}
			if worked, err := s.runLearningJob(ctx); err != nil || !worked {
				t.Fatalf("worked=%v err=%v", worked, err)
			}
			document, err := s.GetDocument(ctx, docID)
			if err != nil || document.String("status") != "learned" || document.String("error_message") != "" || document["learned_at"] == nil || objectInt64(document["chunk_count"]) != 0 {
				t.Fatalf("document=%v err=%v", document, err)
			}
			chunks, err := s.ListChunks(ctx, docID)
			if err != nil || len(chunks) != 0 {
				t.Fatalf("chunks=%v err=%v", chunks, err)
			}
			var status string
			if err := pool.QueryRow(ctx, `SELECT status FROM knowledge_base_learning_jobs WHERE kb_id=$1`, kbID).Scan(&status); err != nil || status != "succeeded" {
				t.Fatalf("job status=%q err=%v", status, err)
			}
		})
	}
}

func TestFormatVectorRejectsInvalidValues(t *testing.T) {
	if _, err := formatVector(nil); err == nil {
		t.Fatal("空向量应失败")
	}
	if got, err := formatVector([]float64{0.1, -2, 3.25}); err != nil || got != "[0.1,-2,3.25]" {
		t.Fatalf("格式化向量 = %q, %v", got, err)
	}
	if _, err := formatVector([]float64{1, 0}); err != nil {
		t.Fatalf("有效向量被拒绝: %v", err)
	}
}

func TestLearningSkipsUnsearchableChunksBeforeEmbedding(t *testing.T) {
	pool, actor := kbTestPool(t)
	ctx := t.Context()
	s, kbID, docID := seedLearningKB(t, pool, actor, OperationRelearn, "pending")
	content := strings.Repeat("-", chunkRunes*2) + "有效正文"
	if _, err := pool.Exec(ctx, `UPDATE knowledge_base_documents SET content=$2,file_type='txt' WHERE id=$1`, docID, content); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE knowledge_base_learning_jobs SET document_id=$2 WHERE kb_id=$1`, kbID, docID); err != nil {
		t.Fatal(err)
	}
	calls := 0
	s.models = callbackEmbedder(func(_ context.Context, _, input string) (model.EmbeddingResult, error) {
		calls++
		if !strings.Contains(input, "有效正文") {
			t.Fatalf("embedded invalid chunk: %q", input)
		}
		return model.EmbeddingResult{Vector: []float64{1, 0, 0}}, nil
	})
	if worked, err := s.runLearningJob(ctx); err != nil || !worked {
		t.Fatalf("worked=%v err=%v", worked, err)
	}
	var index int
	var hasVector bool
	if err := pool.QueryRow(ctx, `SELECT chunk_index,embedding IS NOT NULL FROM knowledge_base_chunks WHERE document_id=$1`, docID).Scan(&index, &hasVector); err != nil {
		t.Fatal(err)
	}
	document, err := s.GetDocument(ctx, docID)
	if err != nil || document.String("status") != "learned" || objectInt64(document["chunk_count"]) != 1 || calls != 1 || index != 0 || !hasVector {
		t.Fatalf("document=%v err=%v calls=%d index=%d vector=%v", document, err, calls, index, hasVector)
	}
}
