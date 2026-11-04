package setting

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
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

func TestPostgresBrandingUpdatesPreserveIndependentFields(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set MONKEYAI_TEST_DATABASE_URL to test branding SQL")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "test_branding_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}
	var user string
	if err := pool.QueryRow(ctx, `INSERT INTO users(name,email,role) VALUES('Admin','logo@example.test','admin') RETURNING id`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	store := NewPostgres(pool)
	// The first logo upload also works before any names were saved.
	first, err := store.PutBrandingLogo(ctx, "branding/logos/first.png", user)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(first.Value), `"MonkeyAI"`) {
		t.Fatalf("missing default names: %s", first.Value)
	}
	// A stale complete settings write must retain the latest logo in the database.
	stale := Record{Key: "branding", Value: json.RawMessage(`{"workspace_name":"Team","product_name":"Product","logo_s3_key":"branding/logos/stale.png"}`), SchemaVersion: 1, UpdatedByUserID: user}
	if _, err := store.Put(ctx, stale); err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	failures := make(chan error, 2)
	group.Go(func() {
		for range 20 {
			if _, err := store.Put(ctx, stale); err != nil {
				failures <- err
				return
			}
		}
	})
	group.Go(func() {
		for range 20 {
			if _, err := store.PutBrandingLogo(ctx, "branding/logos/latest.png", user); err != nil {
				failures <- err
				return
			}
		}
	})
	group.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	assertValue := func(key string) {
		t.Helper()
		record, err := store.Get(ctx, "branding")
		if err != nil {
			t.Fatal(err)
		}
		var value map[string]string
		if err := json.Unmarshal(record.Value, &value); err != nil {
			t.Fatal(err)
		}
		if value["logo_s3_key"] != key || value["workspace_name"] != "Team" || value["product_name"] != "Product" {
			t.Fatalf("lost branding field: %s", record.Value)
		}
	}
	assertValue("branding/logos/latest.png")
	if _, err := store.PutBrandingLogo(ctx, "", user); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(ctx, stale); err != nil {
		t.Fatal(err)
	}
	assertValue("")

	storage := &logoStorage{files: map[string][]byte{}}
	service := NewService(store).WithLogoStorage(storage, "https://example.test")
	identities := identity.NewService(pool, service, "https://example.test").WithBrandingLogo(service)
	admin := chi.NewRouter()
	admin.Use(identities.RequireAdmin)
	service.RegisterAdmin(admin)
	session := func(id, token string) *http.Cookie {
		digest := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'oauth',now()+interval '1 hour')`, hex.EncodeToString(digest[:]), id); err != nil {
			t.Fatal(err)
		}
		return &http.Cookie{Name: "monkeyai_session", Value: token}
	}
	adminCookie := session(user, "logo-admin")
	var member string
	if err := pool.QueryRow(ctx, `INSERT INTO users(name,email) VALUES('Member','member@example.test') RETURNING id`).Scan(&member); err != nil {
		t.Fatal(err)
	}
	memberCookie := session(member, "logo-member")
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		cookie *http.Cookie
		status int
	}{{nil, 401}, {memberCookie, 403}, {adminCookie, 200}} {
		req := logoRequest(t, data.Bytes())
		if test.cookie != nil {
			req.AddCookie(test.cookie)
		}
		response := httptest.NewRecorder()
		admin.ServeHTTP(response, req)
		if response.Code != test.status {
			t.Fatalf("permission status=%d want=%d body=%s", response.Code, test.status, response.Body.String())
		}
	}
	public := identities.AuthRouter()
	response := httptest.NewRecorder()
	public.ServeHTTP(response, httptest.NewRequest("GET", "/branding", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"logo_url":"https://example.test/api/auth/v1/branding/logo?v=`) {
		t.Fatalf("public branding=%d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	public.ServeHTTP(response, httptest.NewRequest("GET", "/branding/logo", nil))
	if response.Code != 200 || response.Header().Get("Content-Type") != "image/png" {
		t.Fatal("anonymous logo retrieval failed")
	}
	for _, test := range []struct {
		cookie *http.Cookie
		status int
	}{{nil, 401}, {memberCookie, 403}, {adminCookie, 200}} {
		req := httptest.NewRequest("DELETE", "/settings/branding/logo", nil)
		if test.cookie != nil {
			req.AddCookie(test.cookie)
		}
		response := httptest.NewRecorder()
		admin.ServeHTTP(response, req)
		if response.Code != test.status {
			t.Fatalf("reset permission=%d want=%d", response.Code, test.status)
		}
	}
	assertValue("")

	req := brandingFormRequest(t, "Unified team", "Unified product", "replace", data.Bytes())
	req.AddCookie(adminCookie)
	response = httptest.NewRecorder()
	admin.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatalf("combined save=%d %s", response.Code, response.Body.String())
	}
	stored, err := store.Get(ctx, "branding")
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]string
	if err := json.Unmarshal(stored.Value, &saved); err != nil {
		t.Fatal(err)
	}
	if saved["workspace_name"] != "Unified team" || saved["product_name"] != "Unified product" || saved["logo_s3_key"] == "" {
		t.Fatalf("incomplete combined save: %s", stored.Value)
	}
	req = brandingFormRequest(t, "Team", "Product", "reset", nil)
	req.AddCookie(adminCookie)
	response = httptest.NewRecorder()
	admin.ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatalf("combined reset=%d %s", response.Code, response.Body.String())
	}
	assertValue("")
}
