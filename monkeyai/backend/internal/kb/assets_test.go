package kb

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestKnowledgeImages(t *testing.T) {
	image := avatarImage(t, "png")
	name := strings.TrimPrefix(importHash(image), "sha256:") + ".png"
	fixture := func(extra func(map[string][]byte)) []byte {
		return importFixture(t, func(f map[string][]byte) {
			f["knowledge/manual/assets/"+name] = image
			f["knowledge/manual/doc.md"] = []byte("# 图文\n![说明](../assets/" + name + ")")
			if extra != nil {
				extra(f)
			}
		})
	}
	raw := fixture(nil)
	p, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Books[0].Assets) != 1 {
		t.Fatal("missing asset")
	}
	for _, change := range []func(map[string][]byte){
		func(f map[string][]byte) { delete(f, "knowledge/manual/assets/"+name) },
		func(f map[string][]byte) { f["knowledge/manual/assets/"+name] = []byte("<html>login</html>") },
	} {
		invalid := fixture(change)
		if _, err := ParseImportPackage(bytes.NewReader(invalid), int64(len(invalid))); err == nil {
			t.Fatal("invalid image package accepted")
		}
	}
	pool, admin := kbTestPool(t)
	ctx := t.Context()
	storage := &assetTestStorage{&avatarStorage{files: map[string][]byte{}}}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage)
	plan, err := s.PlanImport(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	plan, err = s.ApplyImport(ctx, tx, p, admin, plan.PlanDigest)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	id := plan.Changes[0].KbID
	var content string
	if err = pool.QueryRow(ctx, "SELECT content FROM knowledge_base_documents WHERE kb_id=$1 AND node_type='document'", id).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(content, assetURL(id, name)) || strings.Contains(content, "../assets/") {
		t.Fatalf("unresolved image: %s", content)
	}
	if _, ok := storage.files[assetObjectKey(id, name)]; !ok {
		t.Fatal("image must be stored under the new library ID")
	}
	// Reimport the exact same package into a second independent library and image prefix.
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.ApplyImport(ctx, tx, p, admin, plan.PlanDigest)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	secondID := second.Changes[0].KbID
	if secondID == id || storage.count() != 2 {
		t.Fatal("reimport must create another library with isolated image storage")
	}
	member := resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'Member',$2)`, member, member+"@example.test"); err != nil {
		t.Fatal(err)
	}
	cookie := func(user, token string) *http.Cookie {
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), user); err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: "monkeyai_session", Value: token}
	}
	adminCookie, memberCookie := cookie(admin, "asset-admin"), cookie(member, "asset-member")
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "").RequireBrowser)
	router.Get("/api/kb/{id}/assets/{name}", s.ServeAsset)
	get := func(session *http.Cookie, expected int) {
		req := httptest.NewRequest("GET", assetURL(id, name), nil)
		if session != nil {
			req.AddCookie(session)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != expected {
			t.Fatalf("asset status=%d want=%d: %s", w.Code, expected, w.Body.String())
		}
		if expected == 200 && (!bytes.Equal(w.Body.Bytes(), image) || w.Header().Get("Content-Type") != "image/png") {
			t.Fatal("image bytes or MIME changed")
		}
	}
	get(nil, 401)
	get(memberCookie, 404)
	get(adminCookie, 200)
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = resource.SaveKbGrants(ctx, tx, id, admin, []resource.Object{{"user_id": member, "access_level": "read_only"}}, false); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	get(memberCookie, 200)
	if _, err = pool.Exec(ctx, "DELETE FROM resource_access_grants WHERE resource_id=$1", id); err != nil {
		t.Fatal(err)
	}
	get(memberCookie, 404)
	book, err := s.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(ctx, admin, id, fmt.Sprintf(`"%v"`, book["revision"])); err != nil {
		t.Fatal(err)
	}
	get(adminCookie, 404)
	if storage.count() != 1 {
		t.Fatal("deleting a library must clean its image prefix only")
	}
	if _, ok := storage.files[assetObjectKey(secondID, name)]; !ok {
		t.Fatal("deleting the first library removed another library's image")
	}
}

type assetTestStorage struct{ *avatarStorage }

func (s *assetTestStorage) DeletePrefix(_ context.Context, prefix string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key := range s.files {
		if strings.HasPrefix(key, prefix) {
			delete(s.files, key)
		}
	}
	return nil
}
