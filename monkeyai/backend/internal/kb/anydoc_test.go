package kb

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestImportContextBoundaries(t *testing.T) {
	s := (&Service{}).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)})
	c := importContext{Purpose: "import", ID: "upload", DocumentID: "doc", Actor: "actor", KB: "kb", Expires: time.Now().Add(time.Hour).Unix()}
	token, err := s.signImport(c)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.verifyImport(token, "import"); err != nil || got.DocumentID != c.DocumentID {
		t.Fatalf("roundtrip: %v", err)
	}
	for _, bad := range []string{"x" + token, token + "x", "invalid"} {
		if _, err := s.verifyImport(bad, "import"); err == nil {
			t.Fatal("accepted tampered token")
		}
	}
	if _, err := s.verifyImport(token, "upload"); err == nil {
		t.Fatal("accepted wrong purpose")
	}
	c.Expires = time.Now().Add(-time.Second).Unix()
	token, _ = s.signImport(c)
	if _, err := s.verifyImport(token, "import"); err == nil {
		t.Fatal("accepted expired token")
	}
}

func TestImportFormatValidation(t *testing.T) {
	for _, name := range []string{"a.doc", "a.ppt", "a.exe"} {
		if _, _, err := importType(name, []byte("content")); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	for _, name := range []string{"a.pdf", "a.docx", "a.xls"} {
		if _, _, err := importType(name, []byte("text")); err == nil {
			t.Fatalf("accepted fake %s", name)
		}
	}
	for name, want := range map[string]string{"a.CSV": "csv", "a.HTML": "html", "a.htm": "html", "a.markdown": "md", "a.svg": "svg", "a.txt": "txt"} {
		got, _, err := importType(name, []byte("source"))
		if err != nil || got != want {
			t.Fatalf("%s: %s %v", name, got, err)
		}
	}
	for _, data := range [][]byte{{0xff}, {'a', 0}, []byte("  "), []byte(strings.Repeat("a", importContentLimit+1))} {
		if _, err := validateImportText(data); err == nil {
			t.Fatal("accepted invalid text")
		}
	}
	if got, err := validateImportText([]byte("\xef\xbb\xbfhello")); err != nil || got != "hello" {
		t.Fatal("BOM handling failed")
	}
}

func TestAnyDocSlimProtocol(t *testing.T) {
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	original := []byte("%PDF-test")
	storage.Put(t.Context(), "original", original, "application/pdf")
	retained, creates, deletes := false, 0, 0
	markdown := "# Converted\n" + strings.Repeat("字", 800000)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/api/slim/task/create" && r.URL.Query().Get("task_id") != "caller-task" {
			t.Error("missing caller task ID")
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /api/slim/task/create":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				return
			}
			defer r.MultipartForm.RemoveAll()
			file, header, err := r.FormFile("file")
			if err != nil {
				t.Error(err)
				return
			}
			defer file.Close()
			data, _ := io.ReadAll(file)
			if !bytes.Equal(data, original) || header.Filename != "original.pdf" || r.FormValue("task_id") != "caller-task" || r.FormValue("uploader") == "" {
				t.Error("invalid multipart")
			}
			creates++
			retained = true
			// The parser has accepted the task, but the caller never receives its response.
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			connection.Close()
			return
		case "GET /api/slim/task/result":
			if !retained {
				w.WriteHeader(404)
				io.WriteString(w, `{"success":false,"err":"task_not_found"}`)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"task_id": "caller-task", "status": "completed", "markdown": markdown}})
		case "DELETE /api/slim/task/delete":
			deletes++
			retained = false
			io.WriteString(w, `{"success":true,"data":{}}`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	s := (&Service{}).WithStorage(storage).WithAnyDoc(AnyDocConfig{URL: server.URL})
	c := importContext{Task: "caller-task", Key: "original", Name: "original.pdf", Size: int64(len(original))}
	if err := s.submitAnyDoc(t.Context(), c, map[string]any{"type": 1}); err == nil {
		t.Fatal("expected lost submit response")
	}
	if err := s.submitAnyDoc(t.Context(), c, map[string]any{"type": 1}); err != nil {
		t.Fatal(err)
	}
	if creates != 1 {
		t.Fatalf("lost reply retry created %d tasks", creates)
	}
	var task anydocTask
	if err := s.anydocRequest(t.Context(), http.MethodGet, "/api/slim/task/result?task_id=caller-task", "", nil, &task); err != nil || task.Markdown == nil || *task.Markdown != markdown {
		t.Fatalf("large Markdown result: %v", err)
	}
	if err := s.validateConvertedAssets(t.Context(), "kb", "![x](https://example.org/a.png)"); err == nil {
		t.Fatal("accepted uncopied image")
	}
	s.cleanupAnyDoc(t.Context(), c.Task)
	if deletes != 1 {
		t.Fatal("result not cleaned")
	}
}

func TestAnyDocSlimErrors(t *testing.T) {
	for _, tc := range []struct {
		status  int
		body    string
		missing bool
	}{
		{404, `{"success":false,"err":"task_not_found"}`, true},
		{429, `{"success":false,"err":"parser_busy"}`, false},
		{503, `{"success":false,"err":"parser_stopping"}`, false},
		{409, `{"success":false,"err":"task_conflict"}`, false},
		{200, `{"success":false}`, false},
		{200, `not json`, false},
		{302, `{"success":true,"data":{}}`, false},
	} {
		t.Run(fmt.Sprint(tc.status, tc.body), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); io.WriteString(w, tc.body) }))
			defer server.Close()
			s := (&Service{}).WithAnyDoc(AnyDocConfig{URL: server.URL})
			err := s.anydocRequest(t.Context(), http.MethodGet, "/api/slim/task/result?task_id=test", "", nil, &anydocTask{})
			if err == nil || errors.Is(err, errAnyDocTaskMissing) != tc.missing {
				t.Fatalf("error %v", err)
			}
		})
	}
	for _, task := range []anydocTask{{TaskID: "other", Status: "completed"}, {TaskID: "test", Status: "pending"}, {}} {
		if validateAnyDocTask(task, "test") == nil {
			t.Fatalf("accepted invalid task %+v", task)
		}
	}
}

func TestMarkdownChunksKeepBlocks(t *testing.T) {
	content := "# Heading\n\n" + strings.Repeat("paragraph ", 50) + "\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```go\nfmt.Println(1)\n```"
	chunks := splitMarkdown(content)
	joined := strings.Join(chunks, "\n\n")
	for _, block := range []string{"# Heading", "| A | B |\n|---|---|\n| 1 | 2 |", "```go\nfmt.Println(1)\n```"} {
		if !strings.Contains(joined, block) {
			t.Fatalf("split block: %s", block)
		}
	}
}

func TestConvertedHTMLValidation(t *testing.T) {
	s := &Service{}
	for _, content := range []string{"<table><tr><td>cell<br>line</td></tr></table>", "text<br />next", "<!-- page -->\n\n# Heading"} {
		if err := s.validateConvertedAssets(context.Background(), "kb", content); err != nil {
			t.Fatalf("safe HTML rejected: %s: %v", content, err)
		}
	}
	for _, content := range []string{"<img src=\"https://example.org/missing.png\">", "<script>alert(1)</script>", "<div onclick=\"alert(1)\">x</div>"} {
		if err := s.validateConvertedAssets(context.Background(), "kb", content); err == nil {
			t.Fatalf("unsafe HTML accepted: %s", content)
		}
	}
}
