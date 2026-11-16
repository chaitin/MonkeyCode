package kb

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestPersonalPermissionsRESTAndAtomicBatch(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	s := NewService(resource.NewStore(pool), nil)
	editor := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'editor',$2)`, editor, editor+"@example.com"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{owner, editor} {
		hash := sha256.Sum256([]byte(id))
		if _, err := pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), id); err != nil {
			t.Fatal(err)
		}
	}
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "").RequireBrowser)
	s.RegisterAgent(router)
	call := func(actor, method, path string, body any, revision string, want int) *httptest.ResponseRecorder {
		t.Helper()
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, strings.NewReader(string(encoded)))
		req.Header.Set("Content-Type", "application/json")
		if revision != "" {
			req.Header.Set("If-Match", revision)
		}
		req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: actor})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	kb, err := s.CreateUserKB(ctx, owner, resource.Object{"name": "personal"})
	if err != nil {
		t.Fatal(err)
	}
	kbID := kb.String("id")
	grants := resource.Object{"kb_id": kbID, "grants": []resource.Object{{"user_id": editor, "access_level": "read_write"}}}
	call(owner, "PUT", "/kb/permissions/update", grants, "", 428)
	call(owner, "PUT", "/kb/permissions/update", grants, `"999"`, 412)
	result := call(owner, "PUT", "/kb/permissions/update", grants, fmt.Sprintf(`"%v"`, kb["revision"]), 200)
	call(editor, "GET", "/kb/permissions/list?kb_id="+kbID, nil, "", 404)
	call(editor, "PUT", "/kb/permissions/update", grants, result.Header().Get("ETag"), 404)
	call(owner, "GET", "/kb/permissions/list?kb_id="+kbID, nil, "", 200)
	response := call(editor, "POST", "/kb/"+kbID+"/documents", resource.Object{"title": "shared", "content": "body"}, "", 202)
	var doc resource.Object
	if err := json.Unmarshal(response.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	docID := doc.String("id")
	path := "/kb/" + kbID + "/documents/" + docID
	call(editor, "GET", path, nil, "", 200)
	call(editor, "PUT", path, resource.Object{"content": "changed"}, "", 428)
	response = call(editor, "PUT", path, resource.Object{"content": "changed", "expected_revision": doc["revision"]}, "", 202)
	if err := json.Unmarshal(response.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateUserKB(ctx, owner, resource.Object{"name": "other"})
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := s.CreateUserDocument(ctx, owner, DocumentInput{KbID: other.String("id"), Title: "foreign", Content: "body"})
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"delete", "move"} {
		call(editor, "POST", "/kb/"+kbID+"/documents/batch", resource.Object{"action": action, "ids": []string{docID, foreign.String("id")}, "expected_revisions": map[string]any{docID: doc["revision"], foreign.String("id"): foreign["revision"]}}, "", 404)
		current, err := s.GetDocument(ctx, docID)
		if err != nil || objectInt64(current["revision"]) != objectInt64(doc["revision"]) {
			t.Fatalf("failed batch changed valid document: %v %v", current, err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET status='disabled',disabled_at=now() WHERE id=$1`, editor); err != nil {
		t.Fatal(err)
	}
	call(editor, "GET", path, nil, "", 401)
	if _, err := s.GetAccessible(ctx, kbID, editor); err == nil {
		t.Fatal("disabled member retained read access")
	}
	if _, err := s.CreateUserDocument(ctx, editor, DocumentInput{KbID: kbID, Title: "disabled", Content: "body"}); err == nil {
		t.Fatal("disabled member retained write access")
	}
}

func TestMetadataEditRequeuesLearningAtNewRevision(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	s := NewService(resource.NewStore(pool), nil)
	kb, err := s.CreateUserKB(ctx, owner, resource.Object{"name": "metadata learning"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := s.CreateUserDocument(ctx, owner, DocumentInput{KbID: kb.String("id"), Title: "before", Content: "unchanged content"})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := s.UpdateUserDocument(ctx, owner, doc.String("id"), DocumentInput{Title: "after", ExpectedRevision: objectInt64(doc["revision"])})
	if err != nil {
		t.Fatal(err)
	}
	if objectInt64(updated["revision"]) != objectInt64(doc["revision"])+1 {
		t.Fatalf("metadata edit did not advance revision: %v", updated)
	}
	if worked, err := s.runLearningJob(ctx); err != nil || !worked {
		t.Fatalf("learning did not resume: %v %v", worked, err)
	}
	current, err := s.GetDocument(ctx, doc.String("id"))
	if err != nil || current.String("status") != "learned" || objectInt64(current["chunk_count"]) == 0 {
		t.Fatalf("metadata edit stranded learning: %v %v", current, err)
	}
	if _, err := s.UpdateUserDocument(ctx, owner, doc.String("id"), DocumentInput{Title: "stale", ExpectedRevision: objectInt64(doc["revision"])}); resource.AsError(err).Status != 412 {
		t.Fatalf("stale metadata write accepted: %v", err)
	}
}
