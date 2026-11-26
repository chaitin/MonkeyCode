package kb

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func mcpFileCall(t *testing.T, client *http.Client, base, key, name string, args resource.Object) (resource.Object, bool) {
	t.Helper()
	body, _ := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": name, "arguments": args}})
	req, _ := http.NewRequest("POST", base+"/mcp/kb", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var reply struct {
		Result struct {
			Structured resource.Object `json:"structuredContent"`
			IsError    bool            `json:"isError"`
		} `json:"result"`
	}
	if err = json.NewDecoder(res.Body).Decode(&reply); err != nil || res.StatusCode != 200 {
		t.Fatalf("MCP reply %d %v", res.StatusCode, err)
	}
	return reply.Result.Structured, reply.Result.IsError
}
func mcpFileBody(t *testing.T, name string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	body := new(bytes.Buffer)
	w := multipart.NewWriter(body)
	f, err := w.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	f.Write(data)
	w.Close()
	return body, w.FormDataContentType()
}
func mcpFileUpload(t *testing.T, client *http.Client, base, key, kb, name string, data []byte, want int) resource.Object {
	t.Helper()
	body, kind := mcpFileBody(t, name, data)
	req, _ := http.NewRequest("POST", base+"/mcp/kb/"+kb+"/files/upload", body)
	req.Header.Set("Content-Type", kind)
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var result resource.Object
	if err = json.NewDecoder(res.Body).Decode(&result); err != nil || res.StatusCode != want {
		t.Fatalf("upload status=%d want=%d body=%v err=%v", res.StatusCode, want, result, err)
	}
	return result
}

func TestMCPFileClientTextAndPermissions(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)})
	book, err := s.CreateUserKB(ctx, owner, resource.Object{"name": "MCP file client"})
	if err != nil {
		t.Fatal(err)
	}
	kb := book.String("id")
	router := chi.NewRouter()
	s.RegisterMCP(router, testMCPKeys{token: "key", scope: "mcp:invoke", user: owner})
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()
	mcpFileUpload(t, client, server.URL, "", kb, "a.txt", []byte("source"), 401)
	mcpFileUpload(t, client, server.URL, "wrong", kb, "a.txt", []byte("source"), 401)
	mcpFileUpload(t, client, server.URL, "key", kb, "legacy.doc", []byte("doc"), 400)
	mcpFileUpload(t, client, server.URL, "key", kb, "fake.pdf", []byte("not PDF"), 400)
	info, failed := mcpFileCall(t, client, server.URL, "key", "kb_upload_file", resource.Object{"kb_id": kb})
	if failed || info.String("status") != "upload_required" || info.String("upload_path") != "/mcp/kb/"+kb+"/files/upload" {
		t.Fatalf("guide %v", info)
	}
	for _, ext := range []string{"txt", "md", "html", "svg", "csv"} {
		original := []byte("<div>original source " + ext + "</div>")
		uploaded := mcpFileUpload(t, client, server.URL, "key", kb, "source."+ext, original, 201)
		if _, ok := uploaded["content"]; ok {
			t.Fatal("multipart response leaked source content")
		}
		args := resource.Object{"kb_id": kb, "import_context": uploaded.String("import_context"), "title": "source " + ext}
		saved, failed := mcpFileCall(t, client, server.URL, "key", "kb_upload_file", args)
		if failed || saved.String("status") != "completed" || saved.String("document_id") == "" {
			t.Fatalf("save %v", saved)
		}
		replay, failed := mcpFileCall(t, client, server.URL, "key", "kb_upload_file", args)
		if failed || replay.String("document_id") != saved.String("document_id") {
			t.Fatalf("replay %v", replay)
		}
		doc, err := s.GetDocument(ctx, saved.String("document_id"))
		if err != nil || doc.String("content") != string(original) || doc.String("file_type") != ext || doc.String("source_type") != "file" {
			t.Fatalf("persisted %v %v", doc, err)
		}
		readback, failed := mcpFileCall(t, client, server.URL, "key", "kb_get_document", resource.Object{"kb_id": kb, "document_id": doc.String("id")})
		if failed || !readback.Bool("has_original") || !readback.Bool("content_editable") {
			t.Fatalf("document capabilities %s: %v", ext, readback)
		}
		var jobs int
		if err = pool.QueryRow(ctx, "SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id=$1", doc.String("id")).Scan(&jobs); err != nil || jobs != 1 {
			t.Fatalf("duplicate jobs %d %v", jobs, err)
		}
		// Revoke the user's account after uploading: no signed context bypasses it.
		if ext == "svg" {
			if _, err = pool.Exec(ctx, "UPDATE users SET status='disabled' WHERE id=$1", owner); err != nil {
				t.Fatal(err)
			}
			_, failed = mcpFileCall(t, client, server.URL, "key", "kb_upload_file", args)
			if !failed {
				t.Fatal("disabled user replay accepted")
			}
			if _, err = pool.Exec(ctx, "UPDATE users SET status='active' WHERE id=$1", owner); err != nil {
				t.Fatal(err)
			}
		}
	}
	encodedUpload, failed := mcpFileCall(t, client, server.URL, "key", "kb_upload_file", resource.Object{"kb_id": kb, "file_name": "a.txt", "data_base64": base64.StdEncoding.EncodeToString([]byte("programmatic text"))})
	if failed || encodedUpload.String("status") != "completed" || encodedUpload.String("import_context") == "" {
		t.Fatalf("programmatic Base64 upload %v", encodedUpload)
	}
	if encodedUpload.String("document_id") == "" {
		t.Fatal("byte upload did not save")
	}
	savedEncoded, failed := mcpFileCall(t, client, server.URL, "key", "kb_upload_file", resource.Object{"kb_id": kb, "import_context": encodedUpload.String("import_context")})
	if failed || savedEncoded.String("status") != "completed" {
		t.Fatalf("Base64 reference import %v", savedEncoded)
	}
	stranger := resource.ID()
	if _, err = pool.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1,'stranger',$2)", stranger, stranger+"@example.test"); err != nil {
		t.Fatal(err)
	}
	otherRouter := chi.NewRouter()
	s.RegisterMCP(otherRouter, testMCPKeys{token: "other", scope: "mcp:invoke", user: stranger})
	other := httptest.NewServer(otherRouter)
	defer other.Close()
	uploaded := mcpFileUpload(t, client, server.URL, "key", kb, "private.txt", []byte("private"), 201)
	_, failed = mcpFileCall(t, other.Client(), other.URL, "other", "kb_upload_file", resource.Object{"kb_id": kb, "import_context": uploaded.String("import_context")})
	if !failed {
		t.Fatal("cross-user context accepted")
	}
	mcpFileUpload(t, other.Client(), other.URL, "other", kb, "a.txt", []byte("source"), 404)
}

func TestMCPFileClientConversionAndImageCallback(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage)
	book, err := s.CreateUserKB(ctx, owner, resource.Object{"name": "MCP binary client"})
	if err != nil {
		t.Fatal(err)
	}
	kb := book.String("id")
	router := chi.NewRouter()
	s.RegisterMCP(router, testMCPKeys{token: "key", scope: "mcp:invoke", user: owner})
	s.RegisterImportCallbacks(router)
	server := httptest.NewServer(router)
	defer server.Close()
	var imageURL string
	queries, exports, deletes := 0, 0, 0
	var taskID string
	converter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/slim/task/create":
			exports++
			var input struct {
				Uploader struct {
					Dir  string `json:"dir"`
					HTTP struct {
						URL string `json:"url"`
					} `json:"http"`
				} `json:"uploader"`
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			taskID = r.FormValue("task_id")
			file, _, err := r.FormFile("file")
			if err != nil {
				t.Error(err)
				return
			}
			original, _ := io.ReadAll(file)
			file.Close()
			if !bytes.HasPrefix(original, []byte("%PDF-")) || taskID == "" {
				t.Error("missing original or task ID")
			}
			if err := json.Unmarshal([]byte(r.FormValue("uploader")), &input.Uploader); err != nil {
				t.Error(err)
			}
			body := new(bytes.Buffer)
			mw := multipart.NewWriter(body)
			f, _ := mw.CreateFormFile("file", "picture.png")
			f.Write(avatarImage(t, "png"))
			mw.WriteField("path", input.Uploader.Dir+"/picture.png")
			mw.Close()
			res, err := http.Post(input.Uploader.HTTP.URL, mw.FormDataContentType(), body)
			if err != nil {
				t.Error(err)
				http.Error(w, "callback failed", 500)
				return
			}
			var callback struct {
				Code int    `json:"code"`
				Data string `json:"data"`
			}
			err = json.NewDecoder(res.Body).Decode(&callback)
			res.Body.Close()
			if err != nil || res.StatusCode != 200 || callback.Code != 0 || callback.Data == "" {
				t.Errorf("callback failed %d %v", res.StatusCode, err)
			}
			imageURL = callback.Data
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(resource.Object{"success": true, "data": resource.Object{"status": "in_process", "err": ""}})
		case "/api/slim/task/result":
			if taskID == "" || r.URL.Query().Get("task_id") != taskID {
				w.WriteHeader(404)
				json.NewEncoder(w).Encode(resource.Object{"success": false, "err": "task_not_found"})
				return
			}
			queries++
			result := resource.Object{"task_id": taskID, "status": "in_process", "err": ""}
			if queries > 1 {
				result["status"] = "completed"
				result["markdown"] = "# Converted\n\n![image](" + imageURL + ")"
			}
			json.NewEncoder(w).Encode(resource.Object{"success": true, "data": result})
		case "/api/slim/task/delete":
			if r.Method != http.MethodDelete || r.URL.Query().Get("task_id") != taskID {
				t.Error("invalid cleanup")
			}
			deletes++
			json.NewEncoder(w).Encode(resource.Object{"success": true, "data": resource.Object{}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer converter.Close()
	s.WithAnyDoc(AnyDocConfig{URL: converter.URL, CallbackBaseURL: server.URL, SigningKey: strings.Repeat("k", 32)})
	uploaded := mcpFileUpload(t, server.Client(), server.URL, "key", kb, "original.pdf", []byte("%PDF-synthetic"), 201)
	args := resource.Object{"kb_id": kb, "import_context": uploaded.String("import_context"), "title": "converted title"}
	start, failed := uploaded, false
	attempt, err := s.verifyImport(start.String("task_context"), "task")
	if err != nil || taskID != attempt.DocumentID || attempt.Task != attempt.DocumentID {
		t.Fatalf("task must equal document ID: %v", err)
	}
	if _, err := s.GetDocument(ctx, attempt.DocumentID); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("document saved without polling: %v", err)
	}
	if failed || start.String("status") != "pending" || start.String("task_context") == "" {
		t.Fatalf("start %v", start)
	}
	poll := resource.Object{"kb_id": kb, "task_context": start.String("task_context")}
	pending, failed := mcpFileCall(t, server.Client(), server.URL, "key", "kb_get_file_import_status", poll)
	if failed || pending.String("status") != "pending" {
		t.Fatalf("pending %v", pending)
	}
	saved, failed := mcpFileCall(t, server.Client(), server.URL, "key", "kb_get_file_import_status", poll)
	if failed || saved.String("status") != "completed" {
		t.Fatalf("completion %v", saved)
	}
	if _, ok := saved["content"]; ok {
		t.Fatal("MCP returned large conversion body")
	}
	doc, err := s.GetDocument(ctx, saved.String("document_id"))
	if err != nil || doc.String("title") != "original.pdf" || doc.String("file_type") != "pdf" || doc.String("source_type") != "file" || !strings.Contains(doc.String("content"), imageURL) {
		t.Fatalf("converted doc %v %v", doc, err)
	}
	if _, _, err = s.readAsset(ctx, kb, strings.TrimPrefix(imageURL, "/api/kb/"+kb+"/assets/")); err != nil {
		t.Fatal(err)
	}
	replay, failed := mcpFileCall(t, server.Client(), server.URL, "key", "kb_get_file_import_status", poll)
	if failed || replay.String("document_id") != saved.String("document_id") || queries != 2 || deletes != 1 {
		t.Fatalf("status replay %v queries=%d", replay, queries)
	}
	restarted, failed := mcpFileCall(t, server.Client(), server.URL, "key", "kb_upload_file", args)
	if failed || restarted.String("document_id") != saved.String("document_id") || exports != 1 {
		t.Fatalf("start replay %v exports=%d", restarted, exports)
	}
	if python, err := exec.LookPath("python3"); err == nil {
		fixture := filepath.Join(t.TempDir(), "client.pdf")
		if err := os.WriteFile(fixture, []byte("%PDF-script-fixture"), 0600); err != nil {
			t.Fatal(err)
		}
		cmd := exec.CommandContext(ctx, python, "../../../scripts/kb-file-import.py", "--server", server.URL, "--kb-id", kb, fixture)
		cmd.Env = append(os.Environ(), "MONKEYAI_MCP_KEY=key")
		var diagnostics bytes.Buffer
		cmd.Stderr = &diagnostics
		output, err := cmd.Output()
		if err != nil {
			t.Fatalf("local client script: %v %s", err, diagnostics.String())
		}
		var result resource.Object
		if err := json.Unmarshal(bytes.TrimSpace(output), &result); err != nil || result.String("status") != "completed" || result.String("document_id") == "" {
			t.Fatalf("client output %s: %v", output, err)
		}
		var attempt resource.Object
		if err := json.Unmarshal(bytes.TrimSpace(diagnostics.Bytes()), &attempt); err != nil || len(attempt.String("upload_key")) != 32 {
			t.Fatalf("missing recovery key: %s %v", diagnostics.String(), err)
		}
		retry := exec.CommandContext(ctx, python, "../../../scripts/kb-file-import.py", "--server", server.URL, "--kb-id", kb, "--upload-key", attempt.String("upload_key"), fixture)
		retry.Env = cmd.Env
		output, err = retry.Output()
		if err != nil {
			t.Fatal(err)
		}
		var repeated resource.Object
		if err := json.Unmarshal(bytes.TrimSpace(output), &repeated); err != nil || repeated.String("document_id") != result.String("document_id") {
			t.Fatalf("script replay created a different document: %s %v", output, err)
		}
	} else {
		t.Log("python3 unavailable; script execution skipped")
	}

}

func TestMCPFileArgumentsAndRequestLimits(t *testing.T) {
	s := &Service{}
	for _, args := range []resource.Object{{}, {"kb_id": 42}, {"kb_id": "kb", "path": "/tmp/private"}, {"kb_id": "kb", "url": "http://internal"}} {
		if _, err := s.callMCPFileImport(t.Context(), "actor", "kb_upload_file", args); err == nil {
			t.Fatalf("accepted invalid args %v", args)
		}
	}
	for _, name := range []string{"kb_upload_file", "kb_get_file_import_status"} {
		body, _ := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": name, "arguments": resource.Object{"data_base64": strings.Repeat("A", 1<<20)}}})
		_, ok := readMCPRequest(httptest.NewRecorder(), httptest.NewRequest("POST", "/mcp/kb", bytes.NewReader(body)))
		if ok != (name == "kb_upload_file") {
			t.Fatalf("large request %s allowed=%v", name, ok)
		}
	}
	for _, tc := range []struct{ actor, purpose string }{{"other", "mcp-import"}, {"actor", "import"}, {"actor", "upload"}} {
		service := (&Service{}).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)})
		c := importContext{Purpose: tc.purpose, ID: "upload", DocumentID: "doc", Actor: tc.actor, KB: "kb", Expires: time.Now().Add(time.Hour).Unix()}
		token, _ := service.signImport(c)
		if _, err := service.callMCPFileImport(t.Context(), "actor", "kb_get_file_import_status", resource.Object{"kb_id": "kb", "task_context": token}); err == nil {
			t.Fatalf("accepted wrong actor/purpose %v", tc)
		}
	}
	// Missing keys fail before touching the database or reading the body.
	router := chi.NewRouter()
	s.RegisterMCP(router, testMCPKeys{token: "key", scope: "mcp:invoke", user: "actor"})
	req := httptest.NewRequest("POST", "/mcp/kb/kb/files/upload", io.NopCloser(strings.NewReader("not read")))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatalf("unauthenticated upload %d", w.Code)
	}
	wrongScope := chi.NewRouter()
	s.RegisterMCP(wrongScope, testMCPKeys{token: "model-only", scope: "model:invoke", user: "actor"})
	request := httptest.NewRequest("POST", "/mcp/kb/kb/files/upload", strings.NewReader("not read"))
	request.Header.Set("Authorization", "Bearer model-only")
	response := httptest.NewRecorder()
	wrongScope.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatalf("accepted model-only key: %d", response.Code)
	}

}

func TestMCPUploadKeyReplaysSavedTextAndImage(t *testing.T) {
	pool, owner := kbTestPool(t)
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	vision := &visionStub{content: "image description"}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)}).WithImageDescriber(vision)
	book, err := s.CreateUserKB(t.Context(), owner, resource.Object{"name": "idempotent uploads"})
	if err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	s.RegisterMCP(router, testMCPKeys{token: "key", scope: "mcp:invoke", user: owner})
	server := httptest.NewServer(router)
	defer server.Close()
	for _, format := range []string{"txt", "png"} {
		data := []byte("text")
		if format == "png" {
			data = imageBytes(t, "png")
		}
		var id string
		for attempt := 0; attempt < 2; attempt++ {
			body := new(bytes.Buffer)
			writer := multipart.NewWriter(body)
			writer.WriteField("upload_key", strings.Repeat("a", 32))
			writer.WriteField("model_id", "vision")
			file, _ := writer.CreateFormFile("file", "source."+format)
			file.Write(data)
			writer.Close()
			req, _ := http.NewRequest("POST", server.URL+"/mcp/kb/"+book.String("id")+"/files/upload", body)
			req.Header.Set("Authorization", "Bearer key")
			req.Header.Set("Content-Type", writer.FormDataContentType())
			response, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			var result resource.Object
			err = json.NewDecoder(response.Body).Decode(&result)
			response.Body.Close()
			if err != nil || response.StatusCode != 201 || result.String("status") != "completed" {
				t.Fatal(response.StatusCode, result, err)
			}
			if attempt == 0 {
				id = result.String("document_id")
			} else if result.String("document_id") != id {
				t.Fatal("duplicate document", result)
			}
		}
		// The programmatic Base64 path shares the same identity with multipart.
		result, failed := mcpFileCall(t, server.Client(), server.URL, "key", "kb_upload_file", resource.Object{"kb_id": book.String("id"), "file_name": "source." + format, "data_base64": base64.StdEncoding.EncodeToString(data), "upload_key": strings.Repeat("a", 32), "model_id": "vision"})
		if failed || result.String("document_id") != id {
			t.Fatal("Base64 replay", result)
		}
	}
	if vision.calls != 1 {
		t.Fatalf("paid parser invoked %d times", vision.calls)
	}
	var documents, jobs int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM knowledge_base_documents WHERE kb_id=$1", book.String("id")).Scan(&documents); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM knowledge_base_learning_jobs WHERE kb_id=$1", book.String("id")).Scan(&jobs); err != nil {
		t.Fatal(err)
	}
	if documents != 2 || jobs != 2 {
		t.Fatalf("documents=%d jobs=%d", documents, jobs)
	}
}
