package kb

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestMCPImageArguments(t *testing.T) {
	service := &Service{}
	for _, arguments := range []map[string]any{
		{}, {"kb_id": resource.ID()}, {"kb_id": 42, "data_base64": "YQ=="},
		{"kb_id": resource.ID(), "data_base64": 42},
		{"kb_id": resource.ID(), "data_base64": "YQ==", "url": "https://example.test/image.png"},
	} {
		if _, err := service.uploadMCPImage(t.Context(), "actor", arguments); err == nil {
			t.Fatal("accepted invalid upload arguments")
		}
	}
}

func TestMCPImageBase64(t *testing.T) {
	original := avatarImage(t, "png")
	decoded, err := decodeMCPImage(base64.StdEncoding.EncodeToString(original))
	if err != nil || !bytes.Equal(decoded, original) {
		t.Fatalf("decode: %v", err)
	}
	for _, encoded := range []string{"", "not base64!", "data:image/png;base64,aGVsbG8=", strings.Repeat("A", mcpImageBase64Limit+1), base64.StdEncoding.EncodeToString(make([]byte, imageUploadLimit+1))} {
		if _, err := decodeMCPImage(encoded); err == nil {
			t.Fatal("accepted invalid or oversized input")
		}
	}
}

func TestMCPImageRequestLimit(t *testing.T) {
	for _, tc := range []struct {
		method, name string
		allowed      bool
	}{
		{"tools/call", "kb_upload_image", true},
		{"tools/call", "kb_create_document", false},
		{"ping", "kb_upload_image", false},
	} {
		body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": tc.method, "params": map[string]any{"name": tc.name, "arguments": map[string]any{"kb_id": resource.ID(), "data_base64": strings.Repeat("A", 1<<20)}}})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "/mcp/kb", bytes.NewReader(body))
		if _, ok := readMCPRequest(httptest.NewRecorder(), req); ok != tc.allowed {
			t.Fatalf("method=%s name=%s allowed=%v", tc.method, tc.name, ok)
		}
	}
	req := httptest.NewRequest("POST", "/mcp/kb", strings.NewReader(strings.Repeat(" ", mcpImageRequestLimit+1)))
	if _, ok := readMCPRequest(httptest.NewRecorder(), req); ok {
		t.Fatal("accepted oversized request")
	}
}

func TestMCPImageUpload(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	storage := &assetTestStorage{&avatarStorage{files: map[string][]byte{}}}
	service := NewService(resource.NewStore(pool), nil).WithStorage(storage)
	id, reader, editor, outsider := resource.ID(), resource.ID(), resource.ID(), resource.ID()
	for _, actor := range []string{reader, editor, outsider} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'image user',$2)`, actor, actor+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,'MCP images',$2,$2,'user')`, id, owner); err != nil {
		t.Fatal(err)
	}
	for actor, access := range map[string]string{reader: "read_only", editor: "read_write"} {
		if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,$3,$4)`, id, actor, access, owner); err != nil {
			t.Fatal(err)
		}
	}
	data := avatarImage(t, "png")
	call := func(actor, encoded string, wantError bool) resource.Object {
		t.Helper()
		router := chi.NewRouter()
		service.RegisterMCP(router, testMCPKeys{token: "image-key", scope: "mcp:invoke", user: actor})
		body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "kb_upload_image", "arguments": map[string]any{"kb_id": id, "data_base64": encoded}}})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "/mcp/kb", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer image-key")
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var reply struct {
			Result struct {
				IsError    bool            `json:"isError"`
				Structured resource.Object `json:"structuredContent"`
			} `json:"result"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &reply); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusOK || reply.Result.IsError != wantError {
			t.Fatalf("actor=%s: %d %s", actor, w.Code, w.Body.String())
		}
		return reply.Result.Structured
	}
	encoded := base64.StdEncoding.EncodeToString(data)
	call(reader, encoded, true)
	call(outsider, encoded, true)
	if storage.count() != 0 {
		t.Fatal("unauthorized upload wrote objects")
	}
	result := call(owner, encoded, false)
	duplicate := call(editor, encoded, false)
	if storage.count() != 1 || result.String("url") != duplicate.String("url") || result.String("markdown") != "![]("+result.String("url")+")" || result.String("mime_type") != "image/png" {
		t.Fatalf("bad upload: %v", result)
	}
	body, err := storage.Get(ctx, assetObjectKey(id, result.String("name")))
	if err != nil {
		t.Fatal(err)
	}
	stored, readErr := io.ReadAll(body)
	closeErr := body.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(stored, data) {
		t.Fatalf("stored bytes differ: read=%v close=%v", readErr, closeErr)
	}
	var documents int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_documents WHERE kb_id=$1`, id).Scan(&documents); err != nil || documents != 0 {
		t.Fatalf("upload must not create documents: count=%d err=%v", documents, err)
	}
	call(owner, base64.StdEncoding.EncodeToString([]byte("<svg/>")), true)
	if _, err := pool.Exec(ctx, `DELETE FROM resource_access_grants WHERE resource_id=$1 AND user_id=$2`, id, editor); err != nil {
		t.Fatal(err)
	}
	call(editor, encoded, true)
	if _, err := pool.Exec(ctx, `UPDATE knowledge_bases SET enabled=false WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	call(owner, encoded, true)
}
