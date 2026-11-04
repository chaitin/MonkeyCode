package setting

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
	"golang.org/x/image/bmp"
	"golang.org/x/image/tiff"
)

type logoStore struct {
	memoryStore
	fail bool
}

func (s *logoStore) PutBrandingLogo(ctx context.Context, key, user string) (Record, error) {
	if s.fail {
		return Record{}, errors.New("write failed")
	}
	value := map[string]any{"workspace_name": "Monkey AI", "product_name": "MonkeyAI"}
	if old, ok := s.records["branding"]; ok {
		if err := json.Unmarshal(old.Value, &value); err != nil {
			return Record{}, err
		}
	}
	delete(value, "logo_s3_key")
	if key != "" {
		value["logo_s3_key"] = key
	}
	data, _ := json.Marshal(value)
	return s.Put(ctx, Record{Key: "branding", Value: data, SchemaVersion: 1, UpdatedByUserID: user})
}

func (s *logoStore) PutBranding(ctx context.Context, workspace, product, key, user string) (Record, error) {
	if s.fail {
		return Record{}, errors.New("write failed")
	}
	data := map[string]any{"workspace_name": workspace, "product_name": product}
	if key != "" {
		data["logo_s3_key"] = key
	}
	encoded, _ := json.Marshal(data)
	return s.Put(ctx, Record{Key: "branding", Value: encoded, SchemaVersion: 1, UpdatedByUserID: user})
}

type logoStorage struct {
	files map[string][]byte
	fail  bool
}

func (s *logoStorage) Put(_ context.Context, key string, data []byte, mime string) error {
	if s.fail {
		return errors.New("storage failed")
	}
	if mime != "image/png" {
		return errors.New("not normalized")
	}
	s.files[key] = append([]byte(nil), data...)
	return nil
}
func (s *logoStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	data, ok := s.files[key]
	if !ok {
		return nil, ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}
func (s *logoStorage) Delete(_ context.Context, key string) error { delete(s.files, key); return nil }
func (*logoStorage) Ping(context.Context) error                   { return nil }

func logoRequest(t *testing.T, data []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("logo", "image.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("PUT", "/settings/branding/logo", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}
func TestBrandLogoLifecycle(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "webp", "gif", "bmp", "tiff", "wide", "tall"} {
		t.Run(format, func(t *testing.T) {
			store := &logoStore{memoryStore: memoryStore{records: map[string]Record{"branding": {Key: "branding", Value: json.RawMessage(`{"workspace_name":"Team","product_name":"Product"}`)}}}}
			storage := &logoStorage{files: map[string][]byte{}}
			service := NewService(store).WithLogoStorage(storage, "https://example.test")
			router := chi.NewRouter()
			service.RegisterAdmin(router)
			public := identity.NewService(nil, service, "https://example.test").WithBrandingLogo(service).AuthRouter()
			readURL := func() string {
				response := httptest.NewRecorder()
				public.ServeHTTP(response, httptest.NewRequest("GET", "/branding", nil))
				var result struct {
					Logo string `json:"logo_url"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				return result.Logo
			}
			if got := readURL(); got != "" {
				t.Fatalf("default URL=%s", got)
			}
			var encoded bytes.Buffer
			img := image.NewRGBA(image.Rect(0, 0, 24, 16))
			if format == "wide" {
				img = image.NewRGBA(image.Rect(0, 0, 16384, 1))
			}
			if format == "tall" {
				img = image.NewRGBA(image.Rect(0, 0, 1, 16384))
			}
			var err error
			switch format {
			case "jpeg":
				err = jpeg.Encode(&encoded, img, nil)
			case "gif":
				err = gif.Encode(&encoded, img, nil)
			case "bmp":
				err = bmp.Encode(&encoded, img)
			case "tiff":
				err = tiff.Encode(&encoded, img, nil)
			case "webp":
				var data []byte
				data, err = base64.StdEncoding.DecodeString("UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoIAAYAAUAmJaACdLoB+AADsAD+9Bi3/q0PlofLQ/hIf+Uq8FjdmwAA")
				encoded.Write(data)
			default:
				err = png.Encode(&encoded, img)
			}
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, logoRequest(t, encoded.Bytes()))
			if response.Code != 200 || strings.Contains(response.Body.String(), "logo_s3_key") || !strings.Contains(response.Body.String(), `"logo_url":"https://example.test/`) {
				t.Fatalf("upload=%d %s", response.Code, response.Body.String())
			}
			firstURL := readURL()
			if firstURL == "" {
				t.Fatal("missing public logo")
			}
			picture := httptest.NewRecorder()
			public.ServeHTTP(picture, httptest.NewRequest("GET", "/branding/logo", nil))
			if picture.Code != 200 || picture.Header().Get("Content-Type") != "image/png" {
				t.Fatalf("image=%d %v", picture.Code, picture.Header())
			}
			if _, err := png.Decode(bytes.NewReader(picture.Body.Bytes())); err != nil {
				t.Fatal(err)
			}
			cached := httptest.NewRecorder()
			req := httptest.NewRequest("GET", "/branding/logo", nil)
			req.Header.Set("If-None-Match", picture.Header().Get("ETag"))
			public.ServeHTTP(cached, req)
			if cached.Code != 304 {
				t.Fatalf("cache=%d", cached.Code)
			}
			originalKey, _ := service.logoKey(t.Context())
			_, err = service.Put(t.Context(), "branding", json.RawMessage(`{"workspace_name":"New team","product_name":"New product","logo_s3_key":"private/forged","logo_url":"https://evil.example"}`), 1, "admin")
			if err != nil {
				t.Fatal(err)
			}
			key, _ := service.logoKey(t.Context())
			if key != originalKey || readURL() != firstURL {
				t.Fatal("name update changed logo")
			}
			admin, err := service.AdminGet(t.Context(), "branding")
			if err != nil || strings.Contains(string(admin.Value), "logo_s3_key") || !strings.Contains(string(admin.Value), firstURL) {
				t.Fatalf("admin=%s %v", admin.Value, err)
			}
			agent, err := service.AgentConfig(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(agent.Settings["branding"]), "logo") {
				t.Fatalf("admin-only logo leaked to client settings: %s", agent.Settings["branding"])
			}
			replacement := httptest.NewRecorder()
			router.ServeHTTP(replacement, logoRequest(t, encoded.Bytes()))
			if replacement.Code != 200 || readURL() == firstURL {
				t.Fatal("replacement did not rotate URL")
			}
			if !strings.Contains(replacement.Body.String(), "New team") {
				t.Fatal("upload overwrote names")
			}
			cleared := httptest.NewRecorder()
			router.ServeHTTP(cleared, httptest.NewRequest("DELETE", "/settings/branding/logo", nil))
			if cleared.Code != 200 || readURL() != "" || !strings.Contains(cleared.Body.String(), "New product") {
				t.Fatalf("reset=%d %s", cleared.Code, cleared.Body.String())
			}
			missing := httptest.NewRecorder()
			public.ServeHTTP(missing, httptest.NewRequest("GET", "/branding/logo", nil))
			if missing.Code != 404 {
				t.Fatal("cleared image is still public")
			}
		})
	}
}
func TestBrandLogoInvalidAndFailedWrites(t *testing.T) {
	store := &logoStore{memoryStore: memoryStore{records: map[string]Record{}}}
	storage := &logoStorage{files: map[string][]byte{}}
	service := NewService(store).WithLogoStorage(storage, "https://example.test")
	router := chi.NewRouter()
	service.RegisterAdmin(router)
	var normal bytes.Buffer
	_ = png.Encode(&normal, image.NewRGBA(image.Rect(0, 0, 8, 8)))
	for _, data := range [][]byte{[]byte("not an image"), bytes.Repeat([]byte("x"), logoUploadLimit+1), normal.Bytes()[:40]} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, logoRequest(t, data))
		if response.Code != 400 {
			t.Fatalf("invalid upload=%d", response.Code)
		}
	}
	if len(storage.files) != 0 || len(store.records) != 0 {
		t.Fatal("invalid upload changed storage")
	}
	storage.fail = true
	response := httptest.NewRecorder()
	router.ServeHTTP(response, logoRequest(t, normal.Bytes()))
	if response.Code != 500 {
		t.Fatal("storage failure accepted")
	}
	storage.fail = false
	store.fail = true
	response = httptest.NewRecorder()
	router.ServeHTTP(response, logoRequest(t, normal.Bytes()))
	if response.Code != 500 || len(storage.files) != 0 {
		t.Fatal("failed database write left uploaded object")
	}
}
