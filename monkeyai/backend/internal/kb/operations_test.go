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

func TestAdminDocumentOperationVersions(t *testing.T) {
	_, actor, s, createKB := indexRegressionFixture(t)
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	for _, action := range []string{"move", "delete"} {
		for _, version := range []string{"stale", "negative", "current", "omitted"} {
			t.Run(action+"/"+version, func(t *testing.T) {
				kbID := createKB()
				ids := []string{}
				expected := map[string]int64{}
				before := map[string]resource.Object{}
				for range 2 {
					doc, err := s.CreateDocument(t.Context(), actor, DocumentInput{KbID: kbID, Title: "version test", Content: "body"})
					if err != nil {
						t.Fatal(err)
					}
					id := doc.String("id")
					ids = append(ids, id)
					expected[id] = objectInt64(doc["revision"])
					before[id] = doc
				}
				want := http.StatusOK
				switch version {
				case "stale":
					expected[ids[1]]++
					want = http.StatusPreconditionFailed
				case "negative":
					expected[ids[1]] = -1
					want = http.StatusBadRequest
				case "omitted":
					expected = nil
				}
				body, err := json.Marshal(DocumentOperationInput{IDs: ids, ExpectedRevisions: expected})
				if err != nil {
					t.Fatal(err)
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/kb/"+kbID+"/documents/"+action, strings.NewReader(string(body))))
				if w.Code != want {
					t.Fatalf("got %d want %d: %s", w.Code, want, w.Body.String())
				}
				if want != http.StatusOK {
					for _, id := range ids {
						doc, err := s.GetDocument(t.Context(), id)
						if err != nil {
							t.Fatalf("rejected request deleted document: %v", err)
						}
						for _, key := range []string{"revision", "position", "parent_id", "status"} {
							if fmt.Sprint(doc[key]) != fmt.Sprint(before[id][key]) {
								t.Fatalf("rejected request changed %s: %v -> %v", key, before[id][key], doc[key])
							}
						}
					}
					return
				}
				var result BatchDocumentResult
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if len(result.Succeeded) != len(ids) || len(result.Failed) != 0 {
					t.Fatalf("unexpected result: %+v", result)
				}
			})
		}
	}
}

func TestMoveReportsSelectedDescendants(t *testing.T) {
	_, actor, s, createKB := indexRegressionFixture(t)
	kbID := createKB()
	create := func(kind string, parent *string) resource.Object {
		t.Helper()
		doc, err := s.CreateDocument(t.Context(), actor, DocumentInput{KbID: kbID, Title: kind, NodeType: kind, ParentID: parent, Content: "body"})
		if err != nil {
			t.Fatal(err)
		}
		return doc
	}
	target := create("folder", nil).String("id")
	folder := create("folder", nil)
	folderID := folder.String("id")
	nested := create("folder", &folderID)
	nestedID := nested.String("id")
	child := create("document", &nestedID)
	// Put descendants before their ancestor and include a duplicate and a missing ID.
	ids := []string{child.String("id"), nestedID, folderID}
	missing := resource.ID()
	result, err := s.operateDocuments(t.Context(), kbID, "move", DocumentOperationInput{IDs: append(append([]string{}, ids...), ids[0], missing), ParentID: &target}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Succeeded) != len(ids) || len(result.Failed) != 1 || result.Failed[0].ID != missing {
		t.Fatalf("unexpected result: %+v", result)
	}
	seen := map[string]int{}
	for _, id := range result.Succeeded {
		seen[id]++
	}
	for _, id := range ids {
		if seen[id] != 1 {
			t.Fatalf("missing or duplicate success for %s: %+v", id, result)
		}
	}
	for _, before := range []resource.Object{folder, nested, child} {
		doc, err := s.GetDocument(t.Context(), before.String("id"))
		if err != nil {
			t.Fatal(err)
		}
		wantParent := before.String("parent_id")
		wantRevision := objectInt64(before["revision"])
		if before.String("id") == folderID {
			wantParent = target
			wantRevision++
		}
		if doc.String("parent_id") != wantParent || objectInt64(doc["revision"]) != wantRevision {
			t.Fatalf("incorrect move: %v", doc)
		}
	}
}

func TestNativeDocumentOperationRequestValidation(t *testing.T) {
	router := chi.NewRouter()
	NewService(resource.NewStore(nil), nil).RegisterAgent(router)
	for _, path := range []string{"/kb/test/documents/delete", "/kb/test/documents/move", "/kb/documents/restudy"} {
		for _, body := range []string{`{}`, `{"ids":[]}`, `{"ids":"invalid"}`, `{"id":"legacy"}`} {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
			if w.Code != http.StatusBadRequest {
				t.Fatalf("%s %s: %d %s", path, body, w.Code, w.Body.String())
			}
		}
	}
	routes := map[string]bool{}
	if err := chi.Walk(router, func(method, path string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+path] = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"POST /kb/{id}/documents/batch", "DELETE /kb/{id}/documents/{documentId}"} {
		if routes[route] {
			t.Fatalf("obsolete route still registered: %s", route)
		}
	}
}

func TestNativeMoveAndDeleteDocuments(t *testing.T) {
	_, actor, s, createKB := indexRegressionFixture(t)
	kbID := createKB()
	create := func(kind string) string {
		t.Helper()
		item, err := s.CreateDocument(t.Context(), actor, DocumentInput{KbID: kbID, Title: kind, NodeType: kind, Content: "operation test"})
		if err != nil {
			t.Fatal(err)
		}
		return item.String("id")
	}
	folder, first, second := create("folder"), create("document"), create("document")
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	call := func(action string, input resource.Object) BatchDocumentResult {
		t.Helper()
		body, _ := json.Marshal(input)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/kb/"+kbID+"/documents/"+action, strings.NewReader(string(body))))
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", action, w.Code, w.Body.String())
		}
		var result BatchDocumentResult
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	result := call("move", resource.Object{"ids": []string{first, second, first}, "parent_id": folder})
	if len(result.Succeeded) != 2 || len(result.Failed) != 0 {
		t.Fatalf("move: %+v", result)
	}
	for _, id := range []string{first, second} {
		item, err := s.GetDocument(t.Context(), id)
		if err != nil || item.String("parent_id") != folder {
			t.Fatalf("move did not persist: %v %v", item, err)
		}
	}
	// Sorting still works when a single ID is supplied as an array.
	result = call("move", resource.Object{"ids": []string{second}, "parent_id": folder, "next_id": first})
	if len(result.Succeeded) != 1 || len(result.Failed) != 0 {
		t.Fatalf("sort: %+v", result)
	}
	a, _ := s.GetDocument(t.Context(), first)
	b, _ := s.GetDocument(t.Context(), second)
	if objectFloat(b["position"]) >= objectFloat(a["position"]) {
		t.Fatalf("sort order: %v %v", a["position"], b["position"])
	}
	result = call("delete", resource.Object{"ids": []string{first, second}})
	if len(result.Succeeded) != 2 || len(result.Failed) != 0 {
		t.Fatalf("delete: %+v", result)
	}
	for _, id := range []string{first, second} {
		if _, err := s.GetDocument(t.Context(), id); err == nil {
			t.Fatalf("document retained: %s", id)
		}
	}
}

func TestMCPDocumentOperationIDs(t *testing.T) {
	s := &Service{}
	for _, tool := range []string{"kb_move_document", "kb_delete_document", "kb_restudy_document"} {
		for _, args := range []resource.Object{
			{"kb_id": "kb", "ids": []string{}},
			{"kb_id": "kb", "ids": "invalid"},
			{"kb_id": "kb", "ids": []string{"doc"}, "document_id": "doc"},
		} {
			params, _ := json.Marshal(resource.Object{"name": tool, "arguments": args})
			if _, err := s.callMCPTool(t.Context(), "actor", params); err == nil {
				t.Fatalf("%s accepted %v", tool, args)
			}
		}
	}
}

func TestNativeDocumentOperationRoutes(t *testing.T) {
	for _, admin := range []bool{false, true} {
		router := chi.NewRouter()
		s := NewService(resource.NewStore(nil), nil)
		if admin {
			s.RegisterAdmin(router)
		} else {
			s.RegisterAgent(router)
		}
		routes := map[string]bool{}
		if err := chi.Walk(router, func(method, path string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
			routes[method+" "+path] = true
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"POST /kb/{id}/documents/batch", "DELETE /kb/{id}/documents/{documentId}", "POST /kb/{id}/documents/{documentId}/restudy"} {
			if routes[path] {
				t.Fatalf("obsolete route retained (admin=%v): %s", admin, path)
			}
		}
		for _, path := range []string{"POST /kb/{id}/documents/delete", "POST /kb/{id}/documents/move"} {
			if !routes[path] {
				t.Fatalf("missing route (admin=%v): %s", admin, path)
			}
		}
	}
}

func TestMCPDocumentOperationResults(t *testing.T) {
	pool, actor := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil)
	kb, err := s.CreateUserKB(t.Context(), actor, resource.Object{"name": "MCP batch"})
	if err != nil {
		t.Fatal(err)
	}
	kbID := kb.String("id")
	ids := []string{}
	for range 2 {
		doc, err := s.CreateUserDocument(t.Context(), actor, DocumentInput{KbID: kbID, Title: "doc", Content: "body"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, doc.String("id"))
	}
	for _, tool := range []string{"kb_move_document", "kb_restudy_document", "kb_delete_document"} {
		params, _ := json.Marshal(resource.Object{"name": tool, "arguments": resource.Object{"kb_id": kbID, "ids": ids}})
		response, err := s.callMCPTool(t.Context(), actor, params)
		if err != nil {
			t.Fatalf("%s: %v", tool, err)
		}
		content := response["structuredContent"].(resource.Object)
		succeeded, ok := content["succeeded"].([]string)
		if !ok || len(succeeded) != 2 {
			t.Fatalf("%s dropped operation result: %v", tool, content)
		}
		failed, ok := content["failed"].([]BatchDocumentFailure)
		if !ok || len(failed) != 0 {
			t.Fatalf("%s failed: %v", tool, content)
		}
	}
}
