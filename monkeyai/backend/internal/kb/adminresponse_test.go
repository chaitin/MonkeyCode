package kb

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestAdminIndexOperationsReturnKnowledgeBase(t *testing.T) {
	pool, actor := kbTestPool(t)
	s, kbID, _ := seedLearningKB(t, pool, actor, OperationLearn, "pending")
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	for _, call := range []struct{ path, body string }{
		{"/index/rebuild", `{"operation":"rebuild_lexical"}`},
		{"/embedding-model/switch", `{"embedding_model_id":null}`},
	} {
		current, err := s.Get(t.Context(), kbID)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(http.MethodPost, "/kb/"+kbID+call.path, strings.NewReader(call.body))
		r.Header.Set("If-Match", fmt.Sprintf(`"%v"`, current["revision"]))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != http.StatusOK && w.Code != http.StatusAccepted {
			t.Fatalf("%s: %d %s", call.path, w.Code, w.Body.String())
		}
		var result resource.Object
		if err = json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"name", "embedding_model_id", "embedding_dimension", "capabilities", "index_job_summary"} {
			if _, ok := result[field]; !ok {
				t.Fatalf("%s missing KB field %s: %s", call.path, field, w.Body.String())
			}
		}
		for _, field := range []string{"content_editable", "has_original"} {
			if _, ok := result[field]; ok {
				t.Fatalf("%s returned document capability %s", call.path, field)
			}
		}
		if call.path == "/embedding-model/switch" && result.String("notice") == "" {
			t.Fatal("model switch lost its notice")
		}
	}
}
