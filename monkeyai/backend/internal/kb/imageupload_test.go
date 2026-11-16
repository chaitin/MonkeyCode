package kb

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestContentImageValidation(t *testing.T) {
	var gifData bytes.Buffer
	if err := gif.Encode(&gifData, image.NewPaletted(image.Rect(0, 0, 2, 2), color.Palette{color.Black}), nil); err != nil {
		t.Fatal(err)
	}
	for _, data := range [][]byte{avatarImage(t, "png"), avatarImage(t, "jpeg"), avatarImage(t, "webp"), gifData.Bytes()} {
		name, mime, err := readContentImage(data)
		if err != nil || name == "" || mime == "" {
			t.Fatalf("valid image rejected: %s %s %v", name, mime, err)
		}
	}
	for _, data := range [][]byte{nil, []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), []byte("<html>login</html>"), avatarImage(t, "png")[:24], make([]byte, imageUploadLimit+1)} {
		if _, _, err := readContentImage(data); err == nil {
			t.Fatal("invalid image accepted")
		}
	}
}

func TestContentImageUploadPermissionsAndReadback(t *testing.T) {
	pool, admin := kbTestPool(t)
	ctx := t.Context()
	storage := &assetTestStorage{&avatarStorage{files: map[string][]byte{}}}
	s := NewService(resource.NewStore(pool), nil).WithStorage(storage)
	identities := identity.NewService(pool, nil, "")
	router := chi.NewRouter()
	router.Route("/api/admin/v1", func(r chi.Router) { r.Use(identities.RequireAdmin); s.RegisterAdmin(r) })
	router.Route("/api/v1", func(r chi.Router) { r.Use(identities.RequireAgent); s.RegisterAgent(r) })
	router.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "" {
				identities.RequireAgent(next).ServeHTTP(w, r)
			} else {
				identities.RequireBrowser(next).ServeHTTP(w, r)
			}
		})
	}).Get("/api/kb/{id}/assets/{name}", s.ServeAsset)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	owner, editor, reader, outsider := resource.ID(), resource.ID(), resource.ID(), resource.ID()
	tokens := map[string]string{}
	for _, user := range []string{owner, editor, reader, outsider, admin} {
		if user != admin {
			exec(`INSERT INTO users(id,name,email) VALUES($1,'image user',$2)`, user, user+"@example.test")
		}
		var grant string
		if err := pool.QueryRow(ctx, `INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at) VALUES($1,'monkeyai-desktop','{}',now()+interval '1 day') RETURNING id`, user).Scan(&grant); err != nil {
			t.Fatal(err)
		}
		token := resource.ID()
		digest := sha256.Sum256([]byte(token))
		exec(`INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'monkeyai-desktop',$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')`, user, grant, hex.EncodeToString(digest[:]), "refresh-"+token)
		tokens[user] = token
	}
	adminDigest := sha256.Sum256([]byte(admin))
	exec(`INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(adminDigest[:]), admin)
	personal, system := resource.ID(), resource.ID()
	exec(`INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,'Personal',$2,$2,'user'),($3,'System',$4,$4,'system')`, personal, owner, system, admin)
	for _, user := range []string{editor, reader} {
		level := "read_write"
		if user == reader {
			level = "read_only"
		}
		exec(`INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,$3,$4)`, personal, user, level, owner)
	}
	data := avatarImage(t, "png")
	upload := func(actor, id string, management bool, files int, content []byte, want int) resource.Object {
		t.Helper()
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		for range files {
			part, err := form.CreateFormFile("file", "untrusted-name.svg")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(content); err != nil {
				t.Fatal(err)
			}
		}
		if err := form.Close(); err != nil {
			t.Fatal(err)
		}
		prefix := "/api/v1"
		if management {
			prefix = "/api/admin/v1"
		}
		req := httptest.NewRequest("POST", prefix+"/kb/"+id+"/images/upload", &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		if actor != "" {
			if management {
				req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: actor})
			} else {
				req.Header.Set("Authorization", "Bearer "+tokens[actor])
			}
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("upload management=%v actor=%s: %d want %d: %s", management, actor, w.Code, want, w.Body.String())
		}
		var out resource.Object
		if want == 201 {
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	upload("", personal, false, 1, data, 401)
	upload(outsider, personal, false, 1, data, 404)
	upload(reader, personal, false, 1, data, 403)
	upload(admin, personal, true, 1, data, 400)
	if storage.count() != 0 {
		t.Fatal("unauthorized requests wrote image objects")
	}
	result := upload(owner, personal, false, 1, data, 201)
	upload(editor, personal, false, 1, data, 201)
	adminResult := upload(admin, system, true, 1, data, 201)
	if storage.count() != 2 || result.String("url") == adminResult.String("url") {
		t.Fatal("images must deduplicate within each KB and remain isolated between KBs")
	}
	if result.String("mime_type") != "image/png" || result.String("markdown") != "![]("+result.String("url")+")" {
		t.Fatalf("bad upload result: %v", result)
	}
	readAsAdmin := func(oauth bool, want int) {
		t.Helper()
		req := httptest.NewRequest("GET", result.String("url"), nil)
		// A browser cookie must not elevate an OAuth-authenticated request.
		req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: admin})
		if oauth {
			req.Header.Set("Authorization", "Bearer "+tokens[admin])
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("admin read oauth=%v: %d want %d: %s", oauth, w.Code, want, w.Body.String())
		}
		if want == http.StatusOK && !bytes.Equal(w.Body.Bytes(), data) {
			t.Fatal("admin readback bytes mismatch")
		}
	}
	readAsAdmin(true, http.StatusNotFound)
	readAsAdmin(false, http.StatusOK)
	exec(`INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, personal, admin, owner)
	readAsAdmin(true, http.StatusOK)
	exec(`DELETE FROM resource_access_grants WHERE resource_id=$1 AND user_id=$2`, personal, admin)
	readAsAdmin(true, http.StatusNotFound)
	readAsAdmin(false, http.StatusOK)
	exec(`INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, personal, admin, owner)
	for _, tc := range []struct {
		files int
		data  []byte
	}{{0, nil}, {2, data}, {1, []byte("<svg/>")}} {
		upload(owner, personal, false, tc.files, tc.data, 400)
	}
	get := func(want int) {
		t.Helper()
		req := httptest.NewRequest("GET", result.String("url"), nil)
		req.Header.Set("Authorization", "Bearer "+tokens[reader])
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("readback: %d want %d: %s", w.Code, want, w.Body.String())
		}
		if want == 200 && (!bytes.Equal(w.Body.Bytes(), data) || w.Header().Get("Cache-Control") != "private, no-store") {
			t.Fatal("readback bytes or cache policy mismatch")
		}
	}
	get(200)
	exec(`DELETE FROM resource_access_grants WHERE resource_id=$1 AND user_id=$2`, personal, reader)
	get(404)
	exec(`DELETE FROM resource_access_grants WHERE resource_id=$1 AND user_id=$2`, personal, editor)
	upload(editor, personal, false, 1, data, 404)
	exec(`UPDATE knowledge_bases SET enabled=false WHERE id=$1`, personal)
	readAsAdmin(true, http.StatusNotFound)
	readAsAdmin(false, http.StatusOK)
	upload(owner, personal, false, 1, data, 404)
	book, err := s.Get(ctx, personal)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteUserKB(ctx, owner, personal, fmt.Sprintf(`"%v"`, book["revision"])); err != nil {
		t.Fatal(err)
	}
	if storage.count() != 1 {
		t.Fatal("deletion must clean only the deleted KB image prefix")
	}
	get(404)
}

type assetTestStorage struct{ *avatarStorage }

func (s *assetTestStorage) DeletePrefix(_ context.Context, prefix string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key := range s.files {
		if strings.HasPrefix(key, prefix) {
			delete(s.files, key)
		}
	}
	return nil
}
