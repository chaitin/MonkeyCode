package kb

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestKnowledgeBasePagesFollowNameOrder(t *testing.T) {
	pool, actor := kbTestPool(t)
	// UUID order deliberately differs from name order.
	ids := []string{"ffffffff-ffff-4fff-8fff-ffffffffffff", "11111111-1111-4111-8111-111111111111", "88888888-8888-4888-8888-888888888888"}
	for i, name := range []string{"Alpha", "beta", "Charlie"} {
		if _, err := pool.Exec(t.Context(), `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id) VALUES($1,$2,$3,$3)`, ids[i], name, actor); err != nil {
			t.Fatal(err)
		}
	}
	var got []string
	cursor := ""
	for range 4 {
		filter, _ := json.Marshal(resource.Object{"ownership": "system", "search": "", "cursor": cursor, "limit": 1})
		items, err := resource.DecodeObjects(newRepository(pool).PageResources(t.Context(), filter))
		if err != nil {
			t.Fatal(err)
		}
		if len(items) == 0 {
			break
		}
		cursor = items[0].String("id")
		got = append(got, cursor)
	}
	if !reflect.DeepEqual(got, ids) {
		t.Fatalf("pages = %v, want %v", got, ids)
	}
}

func TestSearchReusesFailedEmbeddingAcrossKnowledgeBases(t *testing.T) {
	pool, _ := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil)
	calls := 0
	s.models = callbackEmbedder(func(context.Context, string, string) (model.EmbeddingResult, error) {
		calls++
		return model.EmbeddingResult{}, errors.New("upstream unavailable")
	})
	items := []resource.Object{
		{"id": resource.ID(), "embedding_model_id": resource.ID(), "embedding_dimension": 3},
		{"id": resource.ID(), "embedding_dimension": 3},
	}
	items[1]["embedding_model_id"] = items[0]["embedding_model_id"]
	result, err := s.searchAccessible(t.Context(), items, SearchInput{Query: "test"})
	if err != nil || !result.Degraded || result.RetrievalMode != SearchModeLexical || calls != 1 {
		t.Fatalf("calls=%d result=%+v err=%v", calls, result, err)
	}
}
