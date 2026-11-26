package kb

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestImportSlotCancellationAndRelease(t *testing.T) {
	slots := make(chan struct{}, 1)
	release, err := acquireImportSlot(t.Context(), slots)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() {
		r, err := acquireImportSlot(ctx, slots)
		if r != nil {
			r()
		}
		done <- err
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("waiting submission ignored cancellation")
	}
	release()
	r, err := acquireImportSlot(t.Context(), slots)
	if err != nil {
		t.Fatal(err)
	}
	r()
	ctx, cancel = context.WithCancel(t.Context())
	cancel()
	if r, err := acquireImportSlot(ctx, slots); r != nil || !errors.Is(err, context.Canceled) {
		t.Fatal("canceled submission acquired slot")
	}
}

func TestAnyDocSubmissionWaitsBeforeReadingOriginal(t *testing.T) {
	// Saturate the process-wide submission semaphore. A canceled request must not
	// touch object storage or HTTP, and must not leak another slot.
	for i := 0; i < cap(anydocSubmissions); i++ {
		anydocSubmissions <- struct{}{}
	}
	defer func() {
		for i := 0; i < cap(anydocSubmissions); i++ {
			<-anydocSubmissions
		}
	}()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	s := &Service{}
	if err := s.submitAnyDoc(ctx, importContext{}, nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestAnyDocSubmissionReleasesSlotOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "busy", http.StatusServiceUnavailable) }))
	defer server.Close()
	s := (&Service{}).WithAnyDoc(AnyDocConfig{URL: server.URL})
	for i := 0; i < cap(anydocSubmissions)+1; i++ {
		if err := s.submitAnyDoc(t.Context(), importContext{Task: "doc"}, nil); err == nil {
			t.Fatal("accepted invalid result")
		}
	}
	if len(anydocSubmissions) != 0 {
		t.Fatal("submission leaked slot")
	}
}

func TestLegacyImportActionsAreNotPublic(t *testing.T) {
	// The live authenticated upload/query path is covered by database tests;
	// ensure legacy signature-bearing actions cannot accidentally remain exposed.
	s := (&Service{}).WithAnyDoc(AnyDocConfig{SigningKey: strings.Repeat("k", 32)})
	router := chi.NewRouter()
	s.registerFileImports(router, false)
	for _, op := range []string{"list", "export", "parse", "commit"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", "/kb/book/imports/"+op, strings.NewReader("{}")))
		if w.Code != http.StatusNotFound {
			t.Fatalf("legacy %s exposed: %d", op, w.Code)
		}
	}
}

func TestAnyDocSubmissionConcurrency(t *testing.T) {
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{"original": []byte("%PDF-test")}}}
	entered := make(chan struct{}, 3)
	unblock := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			w.WriteHeader(404)
			w.Write([]byte(`{"success":false,"err":"task_not_found"}`))
			return
		}
		entered <- struct{}{}
		select {
		case <-unblock:
		case <-r.Context().Done():
			return
		}
		w.WriteHeader(202)
		w.Write([]byte(`{"success":true,"data":{"status":"in_process"}}`))
	}))
	defer func() {
		select {
		case <-unblock:
		default:
			close(unblock)
		}
		server.Close()
	}()
	s := (&Service{}).WithStorage(storage).WithAnyDoc(AnyDocConfig{URL: server.URL})
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			done <- s.submitAnyDoc(t.Context(), importContext{Task: "doc", Key: "original", Name: "original.pdf", Size: 9}, nil)
		}()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("submission failed to enter")
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if err := s.submitAnyDoc(ctx, importContext{Task: "other", Key: "original", Name: "original.pdf", Size: 9}, nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("third submission was not blocked: %v", err)
	}
	select {
	case <-entered:
		t.Fatal("more than two requests entered AnyDoc")
	default:
	}
	close(unblock)
	for i := 0; i < 2; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
}

func TestImportLostSubmissionAndConcurrentCleanup(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{}}}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage)
	book, err := s.CreateUserKB(ctx, owner, resource.Object{"name": "Import recovery"})
	if err != nil {
		t.Fatal(err)
	}
	var c importContext
	accepted, finishDuringQuery := false, false
	creates := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodPost:
			creates++
			accepted = true
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			conn.Close()
		case http.MethodDelete:
			accepted = false
			io.WriteString(w, `{"success":true}`)
		case http.MethodGet:
			if finishDuringQuery {
				finishDuringQuery = false
				// A competing query commits and cleans up after this query's initial
				// existence check, but before its upstream result is returned.
				proof := c
				proof.Purpose = "result"
				proof.Hash = convertedHash("# Recovered")
				token, err := s.signImport(proof)
				if err == nil {
					_, err = s.saveMCPImport(ctx, c, "# Recovered", token)
				}
				if err != nil {
					t.Error(err)
					w.WriteHeader(500)
					return
				}
			}
			if !accepted {
				w.WriteHeader(404)
				io.WriteString(w, `{"success":false,"err":"task_not_found"}`)
				return
			}
			json.NewEncoder(w).Encode(resource.Object{"success": true, "data": resource.Object{"task_id": c.Task, "status": "in_process"}})
		}
	}))
	defer upstream.Close()
	s.WithAnyDoc(AnyDocConfig{URL: upstream.URL, CallbackBaseURL: upstream.URL, SigningKey: strings.Repeat("k", 32)})
	uploaded, err := s.uploadFileImport(ctx, importContext{Actor: owner, KB: book.String("id")}, "file.pdf", []byte("%PDF-test"), false)
	if err != nil {
		t.Fatal(err)
	}
	c, err = s.verifyImport(uploaded.String("import_context"), "import")
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.startFileImport(ctx, c, fileImportInput{})
	if err != nil || first.String("status") != "failed" || !first.Bool("retryable") {
		t.Fatalf("lost response must retain retry: %v %v", first, err)
	}
	c, err = s.verifyImport(first.String("import_context"), "import")
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.startFileImport(ctx, c, fileImportInput{})
	if err != nil || retry.String("status") != "pending" || creates != 1 {
		t.Fatalf("retry duplicated submission: creates=%d err=%v", creates, err)
	}
	c, err = s.verifyImport(retry.String("task_context"), "task")
	if err != nil {
		t.Fatal(err)
	}
	finishDuringQuery = true
	saved, err := s.finishFileImport(ctx, c)
	if err != nil || saved.String("status") != "completed" || saved.String("document_id") != c.DocumentID {
		t.Fatalf("concurrent cleanup reported failure: %v %v", saved, err)
	}
	var jobs int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id=$1", c.DocumentID).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("learning jobs=%d err=%v", jobs, err)
	}
	// An actually missing task still fails, rather than falsely completing.
	missing := c
	missing.DocumentID = resource.ID()
	missing.ID = missing.DocumentID
	missing.Task = missing.DocumentID
	result, err := s.finishFileImport(ctx, missing)
	if err != nil || result.String("status") != "failed" {
		t.Fatalf("missing task: %v %v", result, err)
	}
}

func TestConversionCallbackCredentialWithLongTitle(t *testing.T) {
	parent := "folder"
	c := importContext{
		ID: "document", DocumentID: "document", Actor: "user", KB: "book", Admin: true,
		Key: "original", Name: "original.pdf", Type: "pdf", MIME: "application/pdf", Size: 9,
		Task: "document", Expires: time.Now().Add(30 * time.Minute).Unix(),
		ImportTitle: strings.Repeat("长中文标题", 1000), TargetParent: &parent, ModelID: "model",
	}
	storage := &originalTestStorage{&avatarStorage{files: map[string][]byte{"original": []byte("%PDF-test")}}}
	s := (&Service{}).WithStorage(storage)
	var configs []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			w.WriteHeader(404)
			io.WriteString(w, `{"success":false,"err":"task_not_found"}`)
			return
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
			return
		}
		defer r.MultipartForm.RemoveAll()
		config := r.FormValue("uploader")
		configs = append(configs, config)
		// AnyDoc parser.parseUploader rejects configs over 8192 bytes before parsing.
		if len(config) > 8192 {
			t.Errorf("uploader exceeds AnyDoc limit: %d", len(config))
			w.WriteHeader(400)
			return
		}
		var uploader struct {
			HTTP struct {
				URL string `json:"url"`
			} `json:"http"`
		}
		if err := json.Unmarshal([]byte(config), &uploader); err != nil {
			t.Error(err)
			return
		}
		endpoint, err := url.Parse(uploader.HTTP.URL)
		if err != nil {
			t.Error(err)
			return
		}
		token := endpoint.Query().Get("token")
		got, err := s.verifyImport(token, "upload")
		want := importContext{Purpose: "upload", ID: c.ID, DocumentID: c.DocumentID, Actor: c.Actor, KB: c.KB, Admin: c.Admin, Expires: c.Expires}
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("callback claims: %#v, %v", got, err)
		}
		payload, err := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[0])
		if err != nil {
			t.Error(err)
			return
		}
		var claims map[string]any
		if err := json.Unmarshal(payload, &claims); err != nil {
			t.Error(err)
			return
		}
		if len(claims) != 7 {
			t.Errorf("unexpected callback fields: %v", claims)
		}
		if _, err := s.verifyImport(token, "task"); err == nil {
			t.Error("upload token accepted for polling")
		}
		w.WriteHeader(202)
		io.WriteString(w, `{"success":true,"data":{"status":"in_process"}}`)
	}))
	defer upstream.Close()
	s.WithAnyDoc(AnyDocConfig{URL: upstream.URL, CallbackBaseURL: upstream.URL, SigningKey: strings.Repeat("k", 32)})
	for range 2 {
		token, err := s.submitFileConversion(t.Context(), c)
		if err != nil {
			t.Fatal(err)
		}
		got, err := s.verifyImport(token, "task")
		want := c
		want.Purpose = "task"
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("polling context lost import metadata: %v", err)
		}
	}
	if len(configs) != 2 || configs[0] != configs[1] {
		t.Fatal("retry changed uploader config")
	}
	// Previously issued full-context upload credentials remain valid.
	c.Purpose = "upload"
	legacy, err := s.signImport(c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.verifyImport(legacy, "upload"); err != nil {
		t.Fatal(err)
	}
}
