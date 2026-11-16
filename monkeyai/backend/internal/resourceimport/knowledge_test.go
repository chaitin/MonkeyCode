package resourceimport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func knowledgeFixture(t *testing.T) []byte {
	t.Helper()
	files := map[string][]byte{"knowledge/manual/kb.json": []byte(`{"name":"导入知识库","tags":["PandaWiki"]}`), "knowledge/manual/tree.json": []byte(`{"nodes":[{"key":"folder","title":"目录","node_type":"folder","parent_key":null,"order":0},{"key":"doc","title":"正文","node_type":"document","parent_key":"folder","order":0,"content_path":"knowledge/manual/doc.md"}]}`), "knowledge/manual/doc.md": []byte("# 使用说明\n正文")}
	entry := kb.ImportEntry{Slug: "manual", MetadataPath: "knowledge/manual/kb.json", TreePath: "knowledge/manual/tree.json"}
	for _, name := range []string{entry.MetadataPath, entry.TreePath, "knowledge/manual/doc.md"} {
		entry.Files = append(entry.Files, kb.ImportFile{Path: name, SHA256: digest(files[name]), Size: int64(len(files[name]))})
	}
	files["manifest.json"], _ = json.Marshal(map[string]any{"knowledge_resources": kb.ImportManifest{SchemaVersion: 1, PublisherID: "fixture", ReleaseID: "r1", KnowledgeBases: []kb.ImportEntry{entry}}})
	raw, err := makeZIP(files)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestKnowledgeImportHTTP(t *testing.T) {
	f := newImportTest(t)
	storage := &uploadStorage{objects: map[string][]byte{}}
	catalog := kb.NewService(resource.NewStore(f.pool), nil).WithStorage(storage)
	router := chi.NewRouter()
	router.Use(identity.NewService(f.pool, nil, "").RequireAdmin)
	NewService(f.pool, storage).WithKnowledgeCatalog(catalog).RegisterAdmin(router)
	call := func(method, path string, data any, status int) []byte {
		t.Helper()
		body, _ := json.Marshal(data)
		if raw, ok := data.([]byte); ok {
			body = raw
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		r.AddCookie(f.cookie)
		r.Header.Set("Content-Type", "application/json")
		if _, ok := data.([]byte); ok {
			r.Header.Set("Content-Type", "application/octet-stream")
			r.Header.Set("X-Content-SHA256", digest(body))
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w.Body.Bytes()
	}
	upload := func(raw []byte) Upload {
		var u Upload
		if err := json.Unmarshal(call("POST", "/resource-import-uploads", resource.Object{"files": []UploadFile{{"kb.zip", int64(len(raw))}}}, 201), &u); err != nil {
			t.Fatal(err)
		}
		call("PUT", "/resource-import-uploads/"+u.ID+"/chunks/0", raw, 204)
		call("POST", "/resource-import-uploads/"+u.ID+"/complete", nil, 200)
		return u
	}
	raw := knowledgeFixture(t)
	if name := os.Getenv("MONKEYAI_KB_FIXTURE_ZIP"); name != "" {
		var err error
		raw, err = os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
	}
	u := upload(raw)
	call("POST", "/resource-imports/preview", importInput{UploadID: u.ID}, 400)
	var discovered map[string]any
	if err := json.Unmarshal(call("POST", "/resource-imports/preview", importInput{UploadID: u.ID, DiscoverOnly: true}, 200), &discovered); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(payload(discovered), []byte("knowledge")) {
		t.Fatal("missing knowledge discovery")
	}
	preview := func(u Upload) Preview {
		var p Preview
		if err := json.Unmarshal(call("POST", "/resource-imports/preview", importInput{UploadID: u.ID, Sections: []string{"knowledge"}}, 200), &p); err != nil {
			t.Fatal(err)
		}
		if len(p.Changes) != 0 || p.SectionPlans["knowledge"].Knowledge == nil {
			t.Fatal("knowledge-only must not affect Agent")
		}
		return p
	}
	apply := func(u Upload, p Preview) SectionResults {
		in := importInput{UploadID: u.ID, Sections: []string{"knowledge"}, SectionPlanDigests: map[string]string{"knowledge": p.SectionPlans["knowledge"].PlanDigest}, PackageSHA256: p.PackageSHA256, PlanDigest: p.PlanDigest, Options: Options{ConfirmFinal: true}}
		var out SectionResults
		if err := json.Unmarshal(call("POST", "/resource-imports", in, 200), &out); err != nil {
			t.Fatal(err)
		}
		if out.Status != "succeeded" {
			t.Fatalf("result: %+v", out)
		}
		return out
	}
	p := preview(u)
	apply(u, p)
	apply(u, p)
	count := func(table string) int {
		var n int
		if err := f.pool.QueryRow(t.Context(), fmt.Sprintf("SELECT count(*) FROM %s", table)).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	docs := 0
	folders := 0
	for _, c := range p.SectionPlans["knowledge"].Knowledge.Changes {
		docs += c.Documents
		folders += c.Folders
	}
	if count("knowledge_bases") != len(p.SectionPlans["knowledge"].Knowledge.Changes) || count("knowledge_base_documents") != docs+folders || count("knowledge_base_learning_jobs") != docs || count("resource_access_grants") != 0 {
		t.Fatal("wrong resources, jobs or default access")
	}
	var status string
	if err := f.pool.QueryRow(t.Context(), "SELECT status FROM resource_import_uploads WHERE id=$1", u.ID).Scan(&status); err != nil || status != "imported" {
		t.Fatalf("upload %s %v", status, err)
	}
	var history map[string]any
	if err := json.Unmarshal(call("GET", "/resource-imports", nil, 200), &history); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(payload(history), []byte("knowledge")) {
		t.Fatal("missing import history")
	}
	second := upload(raw)
	p2 := preview(second)
	if p2.SectionPlans["knowledge"].Knowledge.Changes[0].Action != "create" {
		t.Fatal("new upload must create a fresh library")
	}
	apply(second, p2)
	if count("knowledge_base_learning_jobs") != docs*2 || count("knowledge_bases") != len(p.SectionPlans["knowledge"].Knowledge.Changes)*2 {
		t.Fatal("same ZIP in a new upload must create independent resources and jobs")
	}
	// A rollback must not leave any partial library or learning job.
	parsed, err := kb.ParseImportPackage(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	parsed.Manifest.ReleaseID = "rollback"
	parsed.SHA256 = "sha256:rollback"
	plan, err := catalog.PlanImport(t.Context(), parsed)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := f.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = catalog.ApplyImport(t.Context(), tx, parsed, f.actor, plan.PlanDigest); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	if count("knowledge_bases") != len(p.SectionPlans["knowledge"].Knowledge.Changes)*2 || count("knowledge_base_learning_jobs") != docs*2 {
		t.Fatal("rollback leaked state")
	}
	// Publisher/release are informational; different bytes under the same identity are allowed.
	parsed.Manifest.ReleaseID = p.ReleaseID
	parsed.SHA256 = "sha256:different"
	if _, err = catalog.PlanImport(t.Context(), parsed); err != nil {
		t.Fatal(err)
	}
}
