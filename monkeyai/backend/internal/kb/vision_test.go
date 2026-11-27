package kb

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"

	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type poolCheckingVision struct {
	visionStub
	check func(context.Context) error
}

func (v *poolCheckingVision) DescribeImage(ctx context.Context, _, _, _ string, _ []byte) (string, error) {
	if err := v.check(ctx); err != nil {
		return "", err
	}
	return "一只狗", nil
}

func TestImageParseWithSingleBusinessConnection(t *testing.T) {
	pool, actor := kbTestPool(t)
	cfg := pool.Config()
	cfg.MaxConns, cfg.MinConns = 1, 0
	single, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer single.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	newService := func(v ImageDescriber) *Service {
		return NewService(resource.NewStore(single), nil).WithStorage(storage).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)}).WithImageDescriber(v)
	}
	vision := &poolCheckingVision{}
	s := newService(vision)
	book, err := s.CreateUserKB(ctx, actor, resource.Object{"name": "single connection"})
	if err != nil {
		t.Fatal(err)
	}
	upload, err := s.uploadFileImport(ctx, importContext{Actor: actor, KB: book.String("id")}, "dog.png", imageBytes(t, "png"), false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.verifyImport(upload.String("import_context"), "import")
	if err != nil {
		t.Fatal(err)
	}
	otherVision := &visionStub{content: "一只猫"}
	other := newService(otherVision)
	vision.check = func(ctx context.Context) error {
		// Real model resolution and billing also query this business pool.
		if _, err := single.Exec(ctx, "SELECT 1"); err != nil {
			return err
		}
		// A separate service has no shared in-memory guard, like another process.
		if _, err := other.parseImageImport(ctx, c, "vision"); err == nil || !strings.Contains(err.Error(), "图片正在解析") {
			t.Errorf("concurrent parse was not rejected: %v", err)
		}
		return nil
	}
	if _, err := s.parseImageImport(ctx, c, "vision"); err != nil {
		t.Fatal(err)
	}
	if otherVision.calls != 0 {
		t.Fatal("duplicate paid model call")
	}
	// The advisory lock must be released when the first request finishes.
	if _, err := other.parseImageImport(ctx, c, "vision"); err != nil || otherVision.calls != 1 {
		t.Fatalf("lock not released: calls=%d err=%v", otherVision.calls, err)
	}
}

type visionStub struct {
	calls   int
	content string
}

func (v *visionStub) ImageModels(context.Context, string) ([]resource.Object, error) {
	return []resource.Object{{"id": "vision", "display_name": "vision"}}, nil
}
func (v *visionStub) DescribeImage(_ context.Context, _, model, kind string, data []byte) (string, error) {
	v.calls++
	if model != "vision" || kind != "image/png" {
		return "", resource.Invalid("invalid model")
	}
	return v.content, nil
}
func imageBytes(t *testing.T, kind string) []byte {
	t.Helper()
	im := image.NewRGBA(image.Rect(0, 0, 20, 20))
	im.Set(2, 2, color.RGBA{R: 255, A: 255})
	var b bytes.Buffer
	var err error
	if kind == "jpg" {
		err = jpeg.Encode(&b, im, nil)
	} else {
		err = png.Encode(&b, im)
	}
	if err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestImportImagesValidateRealFormat(t *testing.T) {
	for _, name := range []string{"photo.jpeg", "photo.JPG", "photo.PNG"} {
		kind := "jpg"
		if strings.HasSuffix(name, "PNG") {
			kind = "png"
		}
		typ, _, err := importType(name, imageBytes(t, kind))
		if err != nil || typ != kind {
			t.Fatalf("%s %s %v", name, typ, err)
		}
	}
	if _, _, err := importType("photo.jpg", imageBytes(t, "png")); err == nil {
		t.Fatal("accepted disguised image")
	}
	if _, _, err := importType("photo.png", []byte("not an image")); err == nil {
		t.Fatal("accepted broken image")
	}
	if !strings.Contains(" "+tokenizeDocument("一只棕色的狗坐在草地上", "png")+" ", " 狗 ") {
		t.Fatal("missing dog token")
	}
}

// Exercises the real DB, REST upload/parse/commit, learning and MCP image read.
// The model is intentionally a stub: this verifies plumbing, not vision quality.
func TestImageImportSearchOriginalIntegration(t *testing.T) {
	pool, actor := kbTestPool(t)
	ctx := t.Context()
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	vision := &visionStub{content: "## 画面描述\n\n一只棕色的狗坐在草地上。\n\n## 图片内文字\n\n未见可辨识文字"}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)}).WithImageDescriber(vision)
	book, err := s.CreateUserKB(ctx, actor, resource.Object{"name": "photos"})
	if err != nil {
		t.Fatal(err)
	}
	kbID := book.String("id")
	data := imageBytes(t, "png")
	upload, err := s.uploadFileImport(ctx, importContext{Actor: actor, KB: kbID}, "photo-001.png", data, true)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.verifyImport(upload.String("import_context"), "import")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.fileImportOperation(ctx, c, "list", fileImportInput{}); err == nil {
		t.Fatal("image reached anydoc")
	}
	parsed, err := s.parseImageImport(ctx, c, "vision")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.commitFileImport(ctx, c, parsed.String("result_context"), "photo", nil, "forged"); err == nil {
		t.Fatal("accepted forged result")
	}
	doc, created, err := s.commitFileImport(ctx, c, parsed.String("result_context"), "photo", nil, parsed.String("content"))
	if err != nil || !created {
		t.Fatalf("commit %v %v", created, err)
	}
	if doc.String("file_type") != "png" || publicDocument(doc).Bool("content_editable") {
		t.Fatalf("invalid document %v", doc)
	}
	if _, err = s.UpdateUserDocument(ctx, actor, doc.String("id"), DocumentInput{Content: "changed"}); err == nil {
		t.Fatal("editable derived image")
	}
	// Unrelated image and a text document mentioning dogs must not appear.
	vision.content = "## 画面描述\n\n一只猫睡在沙发上。\n\n## 图片内文字\n\n未见可辨识文字"
	uploaded, err := s.uploadFileImport(ctx, importContext{Actor: actor, KB: kbID}, "photo-002.png", data, false)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.callMCPFileImport(ctx, actor, "kb_upload_file", map[string]any{"kb_id": kbID, "import_context": uploaded.String("import_context"), "model_id": "vision"})
	if err != nil || out.String("status") != "completed" {
		t.Fatalf("MCP %v %v", out, err)
	}
	if _, err = s.CreateUserDocument(ctx, actor, DocumentInput{KbID: kbID, Title: "狗", Content: "狗"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		worked, err := s.runLearningJob(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if !worked {
			break
		}
	}
	// Add a second matching chunk: it must still yield one original image.
	_, err = pool.Exec(ctx, `INSERT INTO knowledge_base_chunks(kb_id,document_id,chunk_index,content,search_tokens,search_tsv) VALUES($1,$2,99,'狗在草地上','狗 草地',to_tsvector('simple','狗 草地'))`, kbID, doc.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	response, err := s.SearchLearnedWithResponse(ctx, actor, SearchInput{Query: "狗", FileTypes: []string{"jpg", "png"}, TopK: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Items) != 1 || response.Items[0].String("document_id") != doc.String("id") {
		t.Fatalf("results %v", response.Items)
	}
	meta, ok := response.Items[0]["image"].(resource.Object)
	if !ok || !strings.Contains(meta.String("preview_url"), doc.String("id")) {
		t.Fatal("missing original reference")
	}
	// Confirm the SQL filter happens before candidate limit, not after it.
	if _, err = s.RebuildIndex(ctx, kbID, OperationRebuildLexical, "", ""); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		worked, err := s.runLearningJob(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if !worked {
			break
		}
	}
	response, err = s.SearchLearnedWithResponse(ctx, actor, SearchInput{Query: "狗", FileTypes: []string{"png"}})
	if err != nil || len(response.Items) != 1 {
		t.Fatalf("rebuild %v %v", response, err)
	}
	result, err := s.readMCPDocumentImage(ctx, actor, map[string]any{"kb_id": kbID, "document_id": doc.String("id")})
	if err != nil {
		t.Fatal(err)
	}
	blocks := result["content"].([]any)
	encoded := blocks[1].(resource.Object).String("data")
	original, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || !bytes.Equal(original, data) {
		t.Fatal("wrong original bytes")
	}
	// Use the actual HTTP MCP endpoint and Key authentication, not just helpers.
	mcpRouter := chi.NewRouter()
	s.RegisterMCP(mcpRouter, testMCPKeys{token: "image-key", scope: "mcp:invoke", user: actor})
	server := httptest.NewServer(mcpRouter)
	defer server.Close()
	callBody, _ := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": "kb_get_document_image", "arguments": resource.Object{"kb_id": kbID, "document_id": doc.String("id")}}})
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/mcp/kb", bytes.NewReader(callBody))
	request.Header.Set("Authorization", "Bearer image-key")
	request.Header.Set("Content-Type", "application/json")
	reply, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer reply.Body.Close()
	var wire struct {
		Result struct {
			Content []struct {
				Type string `json:"type"`
				Data string `json:"data"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err = json.NewDecoder(reply.Body).Decode(&wire); err != nil || wire.Result.IsError || len(wire.Result.Content) != 2 || wire.Result.Content[1].Type != "image" {
		t.Fatalf("MCP wire %+v %v", wire, err)
	}
	wireImage, err := base64.StdEncoding.DecodeString(wire.Result.Content[1].Data)
	if err != nil || !bytes.Equal(wireImage, data) {
		t.Fatal("MCP returned incorrect original")
	}
	// Existing import returns the same document without another paid parse.
	before := vision.calls
	repeated, err := s.parseImageImport(ctx, c, "vision")
	if err != nil || !repeated.Bool("exists") || vision.calls != before {
		t.Fatalf("repeat %v %v", repeated, err)
	}
	// Verify protected HTTP preview is actually inline and byte-identical.
	session := "image-preview-session"
	digest := sha256.Sum256([]byte(session))
	if _, err = pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(digest[:]), actor); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "").RequireBrowser)
	s.RegisterAgent(router)
	r := httptest.NewRequest(http.MethodGet, "/kb/"+kbID+"/documents/"+doc.String("id")+"/file/detail?preview=true", nil)
	r.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: session})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/png" || !strings.HasPrefix(w.Header().Get("Content-Disposition"), "inline") || !bytes.Equal(w.Body.Bytes(), data) {
		t.Fatalf("preview %d %s", w.Code, w.Header())
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET status='disabled' WHERE id=$1`, actor); err != nil {
		t.Fatal(err)
	}
	if _, err = s.readMCPDocumentImage(ctx, actor, map[string]any{"kb_id": kbID, "document_id": doc.String("id")}); err == nil {
		t.Fatal("disabled actor read image")
	}
}
