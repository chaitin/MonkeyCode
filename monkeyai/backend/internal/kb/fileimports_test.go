package kb

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type originalTestStorage struct{ *avatarStorage }

func TestMultipartRetryIdentity(t *testing.T) {
	key := strings.Repeat("ab", 16)
	id := func(actor, payload string) string {
		v, err := multipartDocumentID(importContext{KB: "book", Actor: actor}, key, "image.png", []byte(payload))
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	first := id("owner", "image")
	if first == "" || first != id("owner", "image") || first == id("other", "image") || first == id("owner", "other bytes") {
		t.Fatal("retry identity is unstable or insufficiently scoped")
	}
}

func (s *originalTestStorage) PutOriginal(ctx context.Context, key string, data []byte, mime, name string) error {
	return s.Put(ctx, key, data, mime)
}
func (s *originalTestStorage) OriginalInfo(ctx context.Context, key string) (string, string, int64, error) {
	r, e := s.Get(ctx, key)
	if e != nil {
		return "", "", 0, e
	}
	r.Close()
	return "original", "application/octet-stream", 1, nil
}
func (s *originalTestStorage) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "http://storage/original", nil
}

func TestImportCommitDedupAndReadonly(t *testing.T) {
	pool, actor := kbTestPool(t)
	ctx := t.Context()
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)})
	book, e := s.CreateUserKB(ctx, actor, resource.Object{"name": "imports"})
	if e != nil {
		t.Fatal(e)
	}
	direct, e := s.CreateUserDocument(ctx, actor, DocumentInput{KbID: book.String("id"), Title: "direct", Content: "# text"})
	if e != nil || direct.String("file_type") != "md" {
		t.Fatalf("direct %v %v", direct, e)
	}
	c := importContext{Purpose: "import", ID: resource.ID(), DocumentID: resource.ID(), Actor: actor, KB: book.String("id"), Type: "pdf", Key: "original.pdf", Name: "original.pdf", Expires: time.Now().Add(time.Hour).Unix()}
	storage.Put(ctx, c.Key, []byte("pdf"), "application/pdf")
	proof := c
	proof.Purpose = "result"
	proof.Hash = convertedHash("# converted")
	token, _ := s.signImport(proof)
	if _, _, e = s.commitFileImport(ctx, c, token, "pdf", nil, "forged"); e == nil {
		t.Fatal("accepted changed conversion")
	}
	doc, created, e := s.commitFileImport(ctx, c, token, "pdf", nil, "# converted")
	if e != nil || !created || doc.String("source_type") != "file" {
		t.Fatalf("commit %v %v", created, e)
	}
	again, created, e := s.commitFileImport(ctx, c, token, "changed title", nil, "changed body")
	if e != nil || created || again.String("id") != doc.String("id") || again.String("content") != "# converted" {
		t.Fatalf("dedup %v %v", again, e)
	}
	if _, e = s.UpdateUserDocument(ctx, actor, doc.String("id"), DocumentInput{Content: "edit", ExpectedRevision: objectInt64(doc["revision"])}); e == nil {
		t.Fatal("edited converted PDF")
	}
	if _, e = s.UpdateUserDocument(ctx, actor, doc.String("id"), DocumentInput{ClearContent: true, ExpectedRevision: objectInt64(doc["revision"])}); e == nil {
		t.Fatal("cleared converted PDF")
	}
	// Uploaded text remains editable and learnable even though its source is file.
	textImport := c
	textImport.ID, textImport.DocumentID, textImport.Type = resource.ID(), resource.ID(), "txt"
	textImport.Key, textImport.Name = "editable.txt", "editable.txt"
	if e = storage.Put(ctx, textImport.Key, []byte("text source"), "text/plain"); e != nil {
		t.Fatal(e)
	}
	textDoc, _, e := s.commitFileImport(ctx, textImport, "", "text upload", nil, "text source")
	if e != nil || textDoc.String("source_type") != "file" || textDoc.String("file_type") != "txt" {
		t.Fatalf("text import %v %v", textDoc, e)
	}
	updatedText, e := s.UpdateUserDocument(ctx, actor, textDoc.String("id"), DocumentInput{Content: "edited text", ExpectedRevision: objectInt64(textDoc["revision"])})
	if e != nil || objectInt64(updatedText["size_bytes"]) != int64(len("edited text")) {
		t.Fatalf("uploaded text edit: %v %v", updatedText, e)
	}
	if _, e = pool.Exec(ctx, "UPDATE users SET status='disabled' WHERE id=$1", actor); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.commitFileImport(ctx, c, token, "pdf", nil, "# converted"); e == nil {
		t.Fatal("disabled actor reused context")
	}
}

func TestCSVImportIsDirectAndEditable(t *testing.T) {
	pool, actor := kbTestPool(t)
	ctx := t.Context()
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)})
	book, err := s.CreateUserKB(ctx, actor, resource.Object{"name": "CSV"})
	if err != nil {
		t.Fatal(err)
	}
	content := "name,value\nhello,42\n"
	out, err := s.uploadFileImport(ctx, importContext{Actor: actor, KB: book.String("id")}, "table.CSV", []byte("\xef\xbb\xbf"+content), true)
	if err != nil {
		t.Fatal(err)
	}
	if out.String("content") != content || out.String("file_type") != "csv" {
		t.Fatalf("upload %v", out)
	}
	c, err := s.verifyImport(out.String("import_context"), "import")
	if err != nil {
		t.Fatal(err)
	}

	doc, _, err := s.commitFileImport(ctx, c, "", "CSV", nil, content)
	if err != nil {
		t.Fatal(err)
	}
	if !publicDocument(doc).Bool("content_editable") || doc.String("mime_type") != "text/csv" {
		t.Fatalf("CSV capability %v", doc)
	}
	for _, input := range []DocumentInput{{Content: " \t\n"}, {Title: "renamed"}} {
		input.ExpectedRevision = objectInt64(doc["revision"])
		doc, err = s.UpdateUserDocument(ctx, actor, doc.String("id"), input)
		if err != nil || doc.String("content") != " \t\n" {
			t.Fatalf("whitespace not preserved: %v %v", doc, err)
		}
	}
	for _, input := range []DocumentInput{{Content: "name,value\nhello,43\n"}, {edits: []textEdit{{"hello", "updated"}}}, {ClearContent: true}} {
		input.ExpectedRevision = objectInt64(doc["revision"])
		doc, err = s.UpdateUserDocument(ctx, actor, doc.String("id"), input)
		if err != nil {
			t.Fatal(err)
		}
	}
	if doc.String("content") != "" {
		t.Fatal("CSV clear did not persist")
	}

	if _, _, err = s.fileImportOperation(ctx, c, "list", fileImportInput{}); err == nil {
		t.Fatal("CSV sent to conversion")
	}
}
