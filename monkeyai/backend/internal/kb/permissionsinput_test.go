package kb

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestPersonalPermissionsRequiresExplicitGrantArray(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	s := NewService(resource.NewStore(pool), nil)
	editor := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'editor',$2)`, editor, editor+"@example.com"); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(owner))
	if _, err := pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), owner); err != nil {
		t.Fatal(err)
	}
	kb, err := s.CreateUserKB(ctx, owner, resource.Object{"name": "explicit grants"})
	if err != nil {
		t.Fatal(err)
	}
	kbID := kb.String("id")
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "").RequireBrowser)
	s.RegisterAgent(router)
	call := func(body resource.Object, etag string, want int) *httptest.ResponseRecorder {
		t.Helper()
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPut, "/kb/permissions/update", strings.NewReader(string(encoded)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", etag)
		req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: owner})
		result := httptest.NewRecorder()
		router.ServeHTTP(result, req)
		if result.Code != want {
			t.Fatalf("status %d, want %d: %s", result.Code, want, result.Body.String())
		}
		return result
	}
	seeded := call(resource.Object{"kb_id": kbID, "grants": []resource.Object{{"user_id": editor, "access_level": "read_write"}}}, fmt.Sprintf(`"%v"`, kb["revision"]), http.StatusOK)
	etag := seeded.Header().Get("ETag")
	for _, tc := range []struct {
		name string
		body resource.Object
	}{
		{"missing", resource.Object{"kb_id": kbID}},
		{"null", resource.Object{"kb_id": kbID, "grants": nil}},
		{"object", resource.Object{"kb_id": kbID, "grants": resource.Object{}}},
		{"string", resource.Object{"kb_id": kbID, "grants": ""}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			call(tc.body, etag, http.StatusBadRequest)
			var count int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM resource_access_grants WHERE resource_type='kb' AND resource_id=$1`, kbID).Scan(&count); err != nil || count != 1 {
				t.Fatalf("invalid input changed grants: count=%d err=%v", count, err)
			}
			current, err := s.ownedUserKB(ctx, owner, kbID)
			if err != nil || fmt.Sprintf(`"%v"`, current["revision"]) != etag {
				t.Fatalf("invalid input changed revision: %v %v", current, err)
			}
		})
	}
	cleared := call(resource.Object{"kb_id": kbID, "grants": []resource.Object{}}, etag, http.StatusOK)
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM resource_access_grants WHERE resource_type='kb' AND resource_id=$1`, kbID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("explicit empty array did not clear grants: count=%d err=%v", count, err)
	}
	if cleared.Header().Get("ETag") == etag {
		t.Fatal("successful clear did not advance revision")
	}
}
