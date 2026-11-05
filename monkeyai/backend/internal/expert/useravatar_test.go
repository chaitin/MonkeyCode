package expert

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func avatarDataURL(t *testing.T, format string) string {
	t.Helper()
	return "data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(avatarImage(t, format))
}

func TestUserAvatarValidation(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "webp"} {
		avatar, err := readUserAvatar(avatarDataURL(t, format))
		if err != nil || avatar.mime != "image/"+format || !bytes.Equal(avatar.data, avatarImage(t, format)) {
			t.Fatalf("%s: %v", format, err)
		}
	}
	removed, err := readUserAvatar(nil)
	if err != nil || removed == nil || removed.key != "" || len(removed.data) != 0 {
		t.Fatalf("null removal: %v, %v", removed, err)
	}
	var oversized bytes.Buffer
	if err := png.Encode(&oversized, image.NewRGBA(image.Rect(0, 0, userAvatarMaxEdge+1, 1))); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name  string
		value any
		code  string
	}{
		{"object", resource.Object{"key": "other-object"}, "expert_avatar_invalid"},
		{"bool", false, "expert_avatar_invalid"},
		{"empty", "", "expert_avatar_invalid"},
		{"URL", "https://example.test/avatar.png", "expert_avatar_invalid"},
		{"SVG", "data:image/svg+xml;base64,PHN2Zy8+", "expert_avatar_invalid"},
		{"empty data", "data:image/png;base64,", "expert_avatar_invalid"},
		{"encoding", "data:image/png;base64,broken", "expert_avatar_invalid"},
		{"MIME mismatch", strings.Replace(avatarDataURL(t, "png"), "image/png", "image/jpeg", 1), "expert_avatar_invalid"},
		{"corrupt", "data:image/png;base64," + base64.StdEncoding.EncodeToString(avatarImage(t, "png")[:45]), "expert_avatar_invalid"},
		{"size", "data:image/png;base64," + base64.StdEncoding.EncodeToString(make([]byte, userAvatarLimit+1)), "expert_avatar_too_large"},
		{"dimensions", "data:image/png;base64," + base64.StdEncoding.EncodeToString(oversized.Bytes()), "expert_avatar_too_large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := readUserAvatar(tc.value)
			var failure *resource.Error
			if !errors.As(err, &failure) || failure.Code != tc.code {
				t.Fatalf("want %s, got %v", tc.code, err)
			}
		})
	}
}

func TestUserExpertAvatarPersistence(t *testing.T) {
	pool := avatarPool(t)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(t.Context(), query, args...); err != nil {
			t.Fatal(err)
		}
	}
	owner, other := resource.ID(), resource.ID()
	for token, id := range map[string]string{"owner": owner, "other": other} {
		exec(`INSERT INTO users(id,name,email) VALUES($1,$2,$2 || '@example.test')`, id, token)
		hash := sha256.Sum256([]byte(token))
		exec(`INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,$3,now()+interval '1 hour',now()+interval '2 hours')`, id, hex.EncodeToString(hash[:]), token+"-refresh")
	}
	storage := &avatarStorage{files: map[string][]byte{}}
	service := NewService(resource.NewStore(pool)).WithStorage(storage)
	identities := identity.NewService(pool, nil, "http://example.test")
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		r.Use(identities.RequireAgent)
		service.RegisterAgent(r)
	})
	request := func(method, path, token, match string, input resource.Object, want int) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("If-Match", match)
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != want {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, out.Code, want, out.Body.String())
		}
		return out
	}
	decode := func(response *httptest.ResponseRecorder) resource.Object {
		t.Helper()
		var out resource.Object
		if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"avatar_s3_key", "avatar", "_expert_avatar"} {
			if _, exists := out[key]; exists {
				t.Fatalf("exposed avatar internals: %s", response.Body.String())
			}
		}
		return out
	}
	path := "/api/v1/experts"
	request("GET", path+"/avatar-support", "", "", nil, 401)
	support := request("GET", path+"/avatar-support", "owner", "", nil, 200)
	if out := decode(support); out.Int("version") != 1 || !out.Bool("available") || !strings.Contains(support.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("capability: %s", support.Body.String())
	}
	input := resource.Object{"name": "Writer", "prompt": "Write clearly", "avatar": avatarDataURL(t, "png"), "ownership_type": "system", "owner_user_id": other, "avatar_s3_key": "forged", "_expert_avatar": resource.Object{"key": "forged"}}
	request("POST", path, "", "", input, 401)
	created := request("POST", path, "owner", "", input, 201)
	expert := decode(created)
	id := expert.String("id")
	path += "/" + id
	if expert.String("ownership_type") != "user" || !strings.HasPrefix(expert.String("avatar_path"), path+"/avatar?v=") || storage.count() != 1 {
		t.Fatalf("personal avatar not persisted: %v", expert)
	}
	assertState := func(name, key string, revision int64, count int) {
		t.Helper()
		var gotName, gotKey, gotOwner string
		var gotRevision int64
		if err := pool.QueryRow(t.Context(), `SELECT name,avatar_s3_key,revision,owner_user_id FROM experts WHERE id=$1`, id).Scan(&gotName, &gotKey, &gotRevision, &gotOwner); err != nil {
			t.Fatal(err)
		}
		if gotName != name || gotKey != key || gotRevision != revision || gotOwner != owner || storage.count() != count {
			t.Fatalf("partial mutation: name=%s key=%s revision=%d owner=%s objects=%d", gotName, gotKey, gotRevision, gotOwner, storage.count())
		}
	}
	var firstKey string
	if err := pool.QueryRow(t.Context(), `SELECT avatar_s3_key FROM experts WHERE id=$1`, id).Scan(&firstKey); err != nil {
		t.Fatal(err)
	}
	detail := decode(request("GET", path, "owner", "", nil, 200))
	if detail.String("avatar_path") != expert.String("avatar_path") {
		t.Fatal("detail returned a different avatar path")
	}
	read := request("GET", expert.String("avatar_path"), "owner", "", nil, 200)
	if read.Header().Get("Content-Type") != "image/png" || !bytes.Equal(read.Body.Bytes(), avatarImage(t, "png")) {
		t.Fatal("saved PNG cannot be read")
	}
	request("GET", expert.String("avatar_path"), "other", "", nil, 404)
	exec(`INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('expert',$1,$2,'read_only',$3)`, id, other, owner)
	request("GET", expert.String("avatar_path"), "other", "", nil, 200)
	replacement := resource.Object{"name": "Replaced", "avatar": avatarDataURL(t, "webp")}
	request("PUT", path, "other", created.Header().Get("ETag"), replacement, 404)
	assertState("Writer", firstKey, 1, 1)

	preserved := request("PUT", path, "owner", created.Header().Get("ETag"), resource.Object{"name": "Renamed", "avatar_s3_key": "forged", "_expert_avatar": resource.Object{"key": "forged"}}, 200)
	if decode(preserved).String("avatar_path") != expert.String("avatar_path") {
		t.Fatal("omitting avatar replaced the image")
	}
	assertState("Renamed", firstKey, 2, 1)
	request("PUT", path, "owner", "", replacement, 428)
	request("PUT", path, "owner", created.Header().Get("ETag"), replacement, 412)
	request("PUT", path, "owner", preserved.Header().Get("ETag"), resource.Object{"name": "Invalid", "avatar": false}, 400)
	request("PUT", path, "owner", preserved.Header().Get("ETag"), resource.Object{"name": "Rollback", "avatar": avatarDataURL(t, "jpeg"), "tag_ids": []string{resource.ID()}}, 400)
	request("PUT", path, "owner", preserved.Header().Get("ETag"), resource.Object{"name": "Rollback removal", "avatar": nil, "tag_ids": []string{resource.ID()}}, 400)
	assertState("Renamed", firstKey, 2, 1)
	storage.fail = true
	request("PUT", path, "owner", preserved.Header().Get("ETag"), replacement, 500)
	storage.fail = false
	assertState("Renamed", firstKey, 2, 1)

	replaced := request("PUT", path, "owner", preserved.Header().Get("ETag"), replacement, 200)
	current := decode(replaced)
	if current.String("avatar_path") == expert.String("avatar_path") || storage.count() != 1 {
		t.Fatal("replacement did not update the version or clean the previous image")
	}
	read = request("GET", current.String("avatar_path"), "owner", "", nil, 200)
	if read.Header().Get("Content-Type") != "image/webp" || !bytes.Equal(read.Body.Bytes(), avatarImage(t, "webp")) {
		t.Fatal("saved WebP cannot be read")
	}
	removed := request("PUT", path, "owner", replaced.Header().Get("ETag"), resource.Object{"name": "Removed", "avatar": nil}, 200)
	if decode(removed).String("avatar_path") != "" {
		t.Fatal("null did not remove the avatar")
	}
	assertState("Removed", "", 4, 0)
	request("GET", path+"/avatar", "owner", "", nil, 404)
	request("PUT", path, "owner", replaced.Header().Get("ETag"), replacement, 412)
	assertState("Removed", "", 4, 0)

	request("POST", "/api/v1/experts", "owner", "", resource.Object{"name": "Failed creation", "prompt": "", "avatar": avatarDataURL(t, "png")}, 400)
	var count int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM experts WHERE name='Failed creation'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 || storage.count() != 0 {
		t.Fatal("failed creation persisted a resource or leaked an image")
	}
	plain := decode(request("POST", "/api/v1/experts", "owner", "", resource.Object{"name": "Without avatar", "prompt": "Instructions"}, 201))
	if plain.String("avatar_path") != "" {
		t.Fatal("created an avatar without input")
	}
	service.storage = nil
	support = request("GET", "/api/v1/experts/avatar-support", "owner", "", nil, 200)
	if decode(support).Bool("available") {
		t.Fatal("unconfigured storage advertised avatar support")
	}
	unavailable := request("PUT", path, "owner", removed.Header().Get("ETag"), replacement, 503)
	if !strings.Contains(unavailable.Body.String(), "expert_avatar_unavailable") {
		t.Fatal(unavailable.Body.String())
	}
	request("PUT", path, "owner", removed.Header().Get("ETag"), resource.Object{"name": "Still editable"}, 200)
	assertState("Still editable", "", 5, 0)
}
