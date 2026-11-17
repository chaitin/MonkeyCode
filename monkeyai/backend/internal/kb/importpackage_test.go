package kb

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"os"
	"testing"
)

func importFixture(t *testing.T, change func(map[string][]byte)) []byte {
	t.Helper()
	nodes := []ImportNode{{Key: "folder", NodeType: "folder", Title: "目录"}, {Key: "doc", NodeType: "document", ParentKey: optionalString("folder"), Title: "正文", ContentPath: "knowledge/manual/doc.md"}}
	tree, _ := json.Marshal(map[string]any{"nodes": nodes})
	files := map[string][]byte{"knowledge/manual/kb.json": []byte(`{"name":"知识库","tags":["测试"]}`), "knowledge/manual/tree.json": tree, "knowledge/manual/doc.md": []byte("# 文档\n\n正文内容")}
	if change != nil {
		change(files)
	}
	entry := ImportEntry{Slug: "manual", MetadataPath: "knowledge/manual/kb.json", TreePath: "knowledge/manual/tree.json"}
	for name := range files {
		entry.Files = append(entry.Files, ImportFile{Path: name, SHA256: importHash(files[name]), Size: int64(len(files[name]))})
	}
	manifest, _ := json.Marshal(map[string]any{"knowledge_resources": ImportManifest{SchemaVersion: 1, PublisherID: "fixture", ReleaseID: "r1", KnowledgeBases: []ImportEntry{entry}}})
	files["manifest.json"] = manifest
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, data := range files {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func TestKnowledgePackageValidation(t *testing.T) {
	raw := importFixture(t, nil)
	p, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw)))
	if err != nil || len(p.Books) != 1 || len(p.Books[0].Nodes) != 2 {
		t.Fatalf("parse: %+v %v", p, err)
	}
	for _, tc := range []struct {
		name   string
		change func(map[string][]byte)
	}{
		{"cycle", func(f map[string][]byte) {
			f["knowledge/manual/tree.json"] = []byte(`{"nodes":[{"key":"a","node_type":"folder","title":"A","parent_key":"a","order":0}]}`)
		}},
		{"unknown", func(f map[string][]byte) {
			f["knowledge/manual/kb.json"] = []byte(`{"name":"KB","owner_id":"injected"}`)
		}},
		{"duplicate", func(f map[string][]byte) { f["knowledge/manual/kb.json"] = []byte(`{"name":"A","name":"B"}`) }},
		{"missing_body", func(f map[string][]byte) { f["knowledge/manual/doc.md"] = nil }},
		{"traversal", func(f map[string][]byte) { f["../escape"] = []byte("bad") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := importFixture(t, tc.change)
			if _, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw))); err == nil {
				t.Fatal("invalid package accepted")
			}
		})
	}
}
func TestKnowledgeRealPandaWikiPackage(t *testing.T) {
	name := os.Getenv("MONKEYAI_KB_FIXTURE_ZIP")
	if name == "" {
		t.Skip("设置 MONKEYAI_KB_FIXTURE_ZIP 验证真实导出包")
	}
	file, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	stat, _ := file.Stat()
	p, err := ParseImportPackage(file, stat.Size())
	if err != nil {
		t.Fatal(err)
	}
	documents := 0
	for _, b := range p.Books {
		for _, n := range b.Nodes {
			if n.NodeType == "document" {
				documents++
			}
		}
	}
	if documents == 0 {
		t.Fatal("empty real package")
	}
	t.Logf("真实 PandaWiki 包: %d 库、%d 文档", len(p.Books), documents)
}

func TestKnowledgeImportLearning(t *testing.T) {
	pool, actor := kbTestPool(t)
	raw := importFixture(t, nil)
	if name := os.Getenv("MONKEYAI_KB_FIXTURE_ZIP"); name != "" {
		var err error
		raw, err = os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
	}
	p, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	s := NewService(resource.NewStore(pool), nil).WithStorage(&avatarStorage{files: map[string][]byte{}})
	plan, err := s.PlanImport(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	plan, err = s.ApplyImport(t.Context(), tx, p, actor, plan.PlanDigest)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, change := range plan.Changes {
		total += change.Documents
	}
	for i := 0; i < total; i++ {
		worked, err := s.runLearningJob(t.Context())
		if err != nil || !worked {
			t.Fatalf("learning job %d: %v %v", i, worked, err)
		}
	}
	var learned, chunks int
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM knowledge_base_documents WHERE node_type='document' AND status='learned'").Scan(&learned); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM knowledge_base_chunks").Scan(&chunks); err != nil {
		t.Fatal(err)
	}
	if learned != total || chunks < total {
		t.Fatalf("learned=%d chunks=%d expected documents=%d", learned, chunks, total)
	}
	t.Logf("%d 篇正文学习完成，生成 %d 个检索分片", learned, chunks)
}
