package expert

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func avatarPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set MONKEYAI_TEST_DATABASE_URL to test expert avatar persistence")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_expert_avatars_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE") })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		exec(string(data))
	}
	return pool
}

func TestExpertAvatarAtomicSave(t *testing.T) {
	pool := avatarPool(t)
	ctx := t.Context()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	adminID, memberID := resource.ID(), resource.ID()
	exec(`INSERT INTO users(id,name,email,role) VALUES($1,'Admin','avatar-admin@example.test','admin'),($2,'Member','avatar-member@example.test','user')`, adminID, memberID)
	cookie := func(id, token string) *http.Cookie {
		digest := sha256.Sum256([]byte(token))
		exec(`INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'oauth',now()+interval '1 hour')`, hex.EncodeToString(digest[:]), id)
		return &http.Cookie{Name: "monkeyai_session", Value: token}
	}
	adminCookie, memberCookie := cookie(adminID, "avatar-admin-token"), cookie(memberID, "avatar-member-token")
	storage := &avatarStorage{files: map[string][]byte{}}
	svc := NewService(resource.NewStore(pool)).WithStorage(storage)
	identities := identity.NewService(pool, nil, "http://example.test")
	router := chi.NewRouter()
	router.Use(identities.RequireAdmin)
	svc.RegisterAdmin(router)
	request := func(method, path, match string, body io.Reader, contentType string, session *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, strings.TrimPrefix(path, "/api/admin/v1"), body)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		if match != "" {
			req.Header.Set("If-Match", match)
		}
		if session != nil {
			req.AddCookie(session)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	metadata := func(name, prompt string) string {
		data, _ := json.Marshal(resource.Object{"name": name, "description": "Description", "prompt": prompt, "grants": []any{}, "rule_ids": []string{}, "skill_ids": []string{}, "connectors": []any{}, "tag_ids": []string{}})
		return string(data)
	}
	form := func(method, path, match, name, prompt, format string) *httptest.ResponseRecorder {
		body, contentType := expertMultipart(t, metadata(name, prompt), avatarImage(t, format))
		return request(method, path, match, body, contentType, adminCookie)
	}
	decode := func(response *httptest.ResponseRecorder) resource.Object {
		t.Helper()
		if response.Code != 200 {
			t.Fatalf("save: %d %s", response.Code, response.Body.String())
		}
		var out resource.Object
		if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if _, ok := out["avatar_s3_key"]; ok {
			t.Fatal("exposed storage key")
		}
		return out
	}
	state := func(id string) (string, string, int64) {
		t.Helper()
		var name, key string
		var revision int64
		if err := pool.QueryRow(ctx, `SELECT name,coalesce(avatar_s3_key,''),revision FROM experts WHERE id=$1`, id).Scan(&name, &key, &revision); err != nil {
			t.Fatal(err)
		}
		return name, key, revision
	}
	assertState := func(id, name, key string, revision int64) {
		t.Helper()
		gotName, gotKey, gotRevision := state(id)
		if gotName != name || gotKey != key || gotRevision != revision {
			t.Fatalf("partial mutation: %s %s %d, want %s %s %d", gotName, gotKey, gotRevision, name, key, revision)
		}
	}

	for _, session := range []*http.Cookie{nil, memberCookie} {
		body, ct := expertMultipart(t, metadata("Unauthorized", "Prompt"), avatarImage(t, "png"))
		response := request("POST", "/experts", "", body, ct, session)
		if response.Code != 401 && response.Code != 403 {
			t.Fatalf("authorization: %d", response.Code)
		}
	}
	if storage.count() != 0 {
		t.Fatal("unauthorized upload reached storage")
	}
	created := form("POST", "/experts", "", "Avatar expert", "Prompt", "png")
	first := decode(created)
	id := first.String("id")
	firstURL := first.String("avatar_path")
	_, firstKey, revision := state(id)
	if firstURL == "" || firstKey == "" || revision != 1 || storage.count() != 1 {
		t.Fatalf("new avatar not saved: %v", first)
	}
	read := request("GET", firstURL, "", nil, "", adminCookie)
	if read.Code != 200 || read.Header().Get("Content-Type") != "image/png" || !bytes.Equal(read.Body.Bytes(), avatarImage(t, "png")) {
		t.Fatalf("PNG avatar read failed: %d %s %s", read.Code, read.Header().Get("Content-Type"), read.Body.String())
	}
	// A JSON-only edit preserves the image. Supplying an arbitrary key cannot change it.
	jsonBody := strings.TrimSuffix(metadata("Renamed", "Prompt"), "}") + `,"avatar_s3_key":"attacker-object","avatar":{"key":"attacker-object"},"_expert_avatar":{"key":"attacker-object"}}`
	jsonEdit := request("PUT", "/experts/"+id, created.Header().Get("ETag"), strings.NewReader(jsonBody), "application/json", adminCookie)
	decode(jsonEdit)
	assertState(id, "Renamed", firstKey, 2)
	for _, tc := range []struct {
		name, match, prompt string
		status              int
	}{{"stale", `"1"`, "Prompt", 412}, {"missing match", "", "Prompt", 428}, {"invalid prompt", `"2"`, "", 400}} {
		response := form("PUT", "/experts/"+id, tc.match, "Should not persist", tc.prompt, "jpeg")
		if response.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.name, response.Code, response.Body.String())
		}
		assertState(id, "Renamed", firstKey, 2)
		if storage.count() != 1 {
			t.Fatalf("%s leaked an image", tc.name)
		}
	}
	// A later failure after the avatar row was updated still rolls back every field.
	badMetadata := strings.TrimSuffix(metadata("Bad tag", "Prompt"), "}") + `,"tag_ids":["` + resource.ID() + `"]}`
	body, ct := expertMultipart(t, badMetadata, avatarImage(t, "jpeg"))
	failed := request("PUT", "/experts/"+id, `"2"`, body, ct, adminCookie)
	if failed.Code == 200 {
		t.Fatal("accepted unavailable tag")
	}
	assertState(id, "Renamed", firstKey, 2)
	if storage.count() != 1 {
		t.Fatal("rollback leaked staged image")
	}
	// Storage failure leaves both names and the existing image untouched.
	storage.fail = true
	failed = form("PUT", "/experts/"+id, `"2"`, "Upload failure", "Prompt", "jpeg")
	storage.fail = false
	if failed.Code == 200 {
		t.Fatal("storage failure accepted")
	}
	assertState(id, "Renamed", firstKey, 2)
	updated := form("PUT", "/experts/"+id, `"2"`, "Replaced", "Prompt", "jpeg")
	second := decode(updated)
	_, secondKey, _ := state(id)
	if secondKey == firstKey || second.String("avatar_path") == firstURL || storage.count() != 1 {
		t.Fatal("replacement/version/old image cleanup failed")
	}
	assertState(id, "Replaced", secondKey, 3)
	read = request("GET", second.String("avatar_path"), "", nil, "", adminCookie)
	if read.Code != 200 || read.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatal("JPEG avatar read failed")
	}
	// Two writes with the same version cannot both replace the avatar.
	results := make(chan *httptest.ResponseRecorder, 2)
	var workers sync.WaitGroup
	for i := range 2 {
		body, contentType := expertMultipart(t, metadata(fmt.Sprintf("Concurrent %d", i), "Prompt"), avatarImage(t, "webp"))
		workers.Go(func() { results <- request("PUT", "/experts/"+id, `"3"`, body, contentType, adminCookie) })
	}
	workers.Wait()
	close(results)
	statuses := map[int]int{}
	var current resource.Object
	for response := range results {
		statuses[response.Code]++
		if response.Code == 200 {
			current = decode(response)
		}
	}
	if statuses[200] != 1 || statuses[412] != 1 || storage.count() != 1 {
		t.Fatalf("concurrency: %v, objects=%d", statuses, storage.count())
	}
	read = request("GET", current.String("avatar_path"), "", nil, "", adminCookie)
	if read.Code != 200 || read.Header().Get("Content-Type") != "image/webp" {
		t.Fatal("WebP read failed")
	}
	// Package-managed avatars stay immutable, while name overrides retain them.
	importID := resource.ID()
	exec(`INSERT INTO resource_imports(id,publisher,release_id,version,manifest_sha256,actor_user_id,status) VALUES($1,'test.publisher',$2,1,$3,$4,'succeeded')`, importID, resource.ID(), "sha256:"+strings.Repeat("a", 64), adminID)
	exec(`INSERT INTO resource_import_bindings(publisher,slug,resource_type,resource_id,source_sha256,applied_sha256,last_import_id) VALUES('test.publisher','avatar','expert',$1,$2,$2,$3)`, id, "sha256:"+strings.Repeat("a", 64), importID)
	exec(`UPDATE experts SET origin='package' WHERE id=$1`, id)
	_, packageKey, packageRevision := state(id)
	rejected := form("PUT", "/experts/"+id, fmt.Sprintf(`"%d"`, packageRevision), "Package override", "Prompt", "png")
	if rejected.Code != 409 {
		t.Fatalf("package avatar: %d %s", rejected.Code, rejected.Body.String())
	}
	if storage.count() != 1 {
		t.Fatal("package attempt uploaded an object")
	}
	names := request("PUT", "/experts/"+id, fmt.Sprintf(`"%d"`, packageRevision), strings.NewReader(`{"name":"Package name"}`), "application/json", adminCookie)
	decode(names)
	assertState(id, "Package name", packageKey, packageRevision+1)
	// Invalid creation is rolled back and can be retried without duplicate records.
	failed = form("POST", "/experts", "", "Retry creation", "", "png")
	if failed.Code == 200 {
		t.Fatal("invalid creation accepted")
	}
	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM experts WHERE name='Retry creation'`).Scan(&count)
	if count != 0 || storage.count() != 1 {
		t.Fatal("failed creation left partial records or images")
	}
	decode(form("POST", "/experts", "", "Retry creation", "Prompt", "png"))
	if storage.count() != 2 {
		t.Fatal("retry failed")
	}
	withoutAvatar := decode(request("POST", "/experts", "", strings.NewReader(metadata("Without avatar", "Prompt")), "application/json", adminCookie))
	if withoutAvatar.String("avatar_path") != "" || storage.count() != 2 {
		t.Fatal("JSON creation must keep the avatar optional")
	}
	// Cleanup after an ambiguous save error cannot remove a committed image.
	svc.discardUnusedAvatar(ctx, packageKey)
	if storage.count() != 2 {
		t.Fatal("cleanup removed a referenced image")
	}
}
