package kb

import (
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestAgentDocumentOriginalContract(t *testing.T) {
	s := (&Service{}).WithPublicURL("https://kb.example.test/")
	for _, kind := range []string{"txt", "md", "html", "svg", "csv", "pdf", "docx", "xls", "xlsx", "pptx", "jpg", "png", ""} {
		t.Run(kind, func(t *testing.T) {
			item := resource.Object{"id": "doc", "kb_id": "kb", "node_type": "document", "file_type": kind, "content": "private parsed text", "storage_key": "private/key"}
			result := s.agentDocument(item)
			_, hasContent := result["content"]
			if !hasContent || (textFileType(kind) && result.String("content") != "private parsed text") || (!textFileType(kind) && result["content"] != "") {
				t.Fatalf("content visibility: %v", result)
			}
			if result.String("url") != "https://kb.example.test/api/kb/kb/assets/doc."+originalDocumentExtension(item) || !result.Bool("has_original") {
				t.Fatalf("original metadata: %v", result)
			}
			if _, ok := result["storage_key"]; ok {
				t.Fatal("private key leaked")
			}
			if publicDocument(item).String("content") != "private parsed text" {
				t.Fatal("admin content changed")
			}
			summary := s.agentDocumentSummary(item)
			if _, ok := summary["content"]; ok {
				t.Fatal("list content leaked")
			}
			if summary.String("url") != result.String("url") {
				t.Fatal("list original URL missing")
			}
			delete(item, "storage_key")
			if s.agentDocument(item).String("url") != "" {
				t.Fatal("missing original has URL")
			}
		})
	}
	folder := resource.Object{"id": "folder", "kb_id": "kb", "node_type": "folder", "children": []resource.Object{{"id": "nested", "kb_id": "kb", "node_type": "document", "file_type": "pdf", "content": "hidden", "storage_key": "key"}}}
	tree := s.agentDocumentTree([]resource.Object{folder})
	children := tree[0]["children"].([]resource.Object)
	if tree[0].String("url") != "" || children[0].String("url") == "" {
		t.Fatalf("tree URLs: %v", tree)
	}
	for _, node := range []resource.Object{tree[0], children[0]} {
		if _, ok := node["content"]; ok {
			t.Fatal("目录树节点不应包含 content 字段")
		}
	}
}

func TestMCPReadDerivedDocumentReturnsOriginal(t *testing.T) {
	pool, actor := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil).WithPublicURL("https://kb.example.test")
	book, err := s.CreateUserKB(t.Context(), actor, resource.Object{"name": "original contract"})
	if err != nil {
		t.Fatal(err)
	}
	kbID := book.String("id")
	doc, err := s.CreateUserDocument(t.Context(), actor, DocumentInput{KbID: kbID, Title: "original", Content: "derived secret"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(t.Context(), "UPDATE knowledge_base_documents SET file_type='pdf', storage_key='original.pdf' WHERE id=$1", doc.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.readMCPDocument(t.Context(), actor, map[string]any{"kb_id": kbID, "document_id": doc.String("id")})
	if err != nil {
		t.Fatal(err)
	}
	if content, ok := result["content"]; !ok || content != "" {
		t.Fatal("derived content must be an empty string")
	}
	if result.String("url") == "" {
		t.Fatal("original URL missing")
	}
}

func TestOriginalAssetBytes(t *testing.T) {
	for _, kind := range []string{"pdf", "png", "jpg", "html", "svg"} {
		t.Run(kind, func(t *testing.T) {
			data := []byte("%PDF-original bytes")
			if kind == "png" || kind == "jpg" {
				format := kind
				if format == "jpg" {
					format = "jpeg"
				}
				data = avatarImage(t, format)
			}
			storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{"original": data}}}
			s := (&Service{}).WithStorage(storage).WithPublicURL("https://kb.example.test")
			doc := resource.Object{"id": resource.ID(), "kb_id": resource.ID(), "file_type": kind, "storage_key": "original"}
			url := s.originalDocumentURL(doc)
			name := url[strings.LastIndex(url, "/")+1:]
			if !originalAssetName.MatchString(name) {
				t.Fatalf("unroutable URL %s", url)
			}
			req := httptest.NewRequest("GET", url, nil)
			w := httptest.NewRecorder()
			s.writeOriginal(w, req, doc, true)
			if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) {
				t.Fatalf("original bytes: %d %q", w.Code, w.Body.String())
			}
			disposition := "inline"
			if kind == "html" || kind == "svg" {
				disposition = "attachment"
			}
			if !strings.HasPrefix(w.Header().Get("Content-Disposition"), disposition) || w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatalf("headers: %v", w.Header())
			}
		})
	}
	for _, name := range []string{"../original.pdf", "original.pdf", resource.ID() + ".exe"} {
		if originalAssetName.MatchString(name) {
			t.Fatalf("invalid original name: %s", name)
		}
	}
}
