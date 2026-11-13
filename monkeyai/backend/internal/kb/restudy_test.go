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

func TestBatchRestudyRoute(t *testing.T) {
	pool, actor, s, createKB := indexRegressionFixture(t)
	ctx := t.Context()
	kbID := createKB()
	create := func(id, nodeType string) string {
		t.Helper()
		doc, err := s.CreateDocument(ctx, actor, DocumentInput{KbID: id, Title: nodeType, NodeType: nodeType, Content: "restudy test content"})
		if err != nil {
			t.Fatal(err)
		}
		return doc.String("id")
	}
	docID := create(kbID, "document")
	folderID := create(kbID, "folder")
	foreignID := create(createKB(), "document")
	missingID := resource.ID()
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	call := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/kb/"+kbID+"/documents/restudy", strings.NewReader(body)))
		return w
	}
	for _, body := range []string{`{}`, `{"ids":[]}`, `{"ids":"invalid"}`} {
		if w := call(body); w.Code != http.StatusBadRequest {
			t.Fatalf("invalid body: %d %s", w.Code, w.Body.String())
		}
	}
	w := call(fmt.Sprintf(`{"ids":[%q,%q,%q,%q,%q]}`, docID, docID, folderID, foreignID, missingID))
	if w.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var result BatchDocumentResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Succeeded) != 1 || result.Succeeded[0] != docID || len(result.Failed) != 3 {
		t.Fatalf("unexpected result: %+v", result)
	}
	for i, id := range []string{folderID, foreignID, missingID} {
		if result.Failed[i].ID != id || result.Failed[i].Reason == "" {
			t.Fatalf("missing failure: %+v", result)
		}
	}
	var jobs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id=$1 AND status IN ('pending','running')`, docID).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("expected one active job: %d %v", jobs, err)
	}
	foreign, err := s.GetDocument(ctx, foreignID)
	if err != nil || fmt.Sprint(foreign["revision"]) != "1" {
		t.Fatalf("foreign document changed: %v %v", foreign, err)
	}
}
