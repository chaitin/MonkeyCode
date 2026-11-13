package kb

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func avatarImage(t *testing.T, format string) []byte {
	t.Helper()
	var b bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 8, 6))
	img.Set(1, 1, color.RGBA{255, 80, 40, 255})
	var err error
	switch format {
	case "png":
		err = png.Encode(&b, img)
	case "jpeg":
		err = jpeg.Encode(&b, img, nil)
	case "webp":
		data, e := base64.StdEncoding.DecodeString("UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoIAAYAAUAmJaACdLoB+AADsAD+9Bi3/q0PlofLQ/hIf+Uq8FjdmwAA")
		if e != nil {
			t.Fatal(e)
		}
		return data
	}
	if err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func kbMultipart(t *testing.T, metadata string, files ...[]byte) (*bytes.Buffer, string) {
	t.Helper()
	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("metadata", metadata); err != nil {
		t.Fatal(err)
	}
	for _, data := range files {
		part, err := writer.CreateFormFile("avatar", "avatar.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body, writer.FormDataContentType()
}

func TestKbAvatarFormatsAndFormValidation(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "webp"} {
		t.Run(format, func(t *testing.T) {
			data := avatarImage(t, format)
			avatar, err := readAvatar(data)
			if err != nil || !bytes.Equal(avatar.data, data) {
				t.Fatalf("valid image: %v", err)
			}
			want := "image/" + format
			if avatar.mime != want {
				t.Fatalf("mime %s, want %s", avatar.mime, want)
			}
		})
	}
	png := avatarImage(t, "png")
	for _, tc := range []struct {
		name, metadata string
		files          [][]byte
		valid          bool
	}{
		{"valid", `{"name":"Example","prompt":"Instructions"}`, [][]byte{png}, true},
		{"no image", `{}`, nil, false},
		{"multiple images", `{}`, [][]byte{png, png}, false},
		{"bad metadata", `{"name":`, [][]byte{png}, false},
		{"null metadata", `null`, [][]byte{png}, false},
		{"array metadata", `[]`, [][]byte{png}, false},
		{"large metadata", `{"name":"` + strings.Repeat("x", 1<<20) + `"}`, [][]byte{png}, false},
		{"corrupt image", `{}`, [][]byte{png[:len(png)/2]}, false},
		{"SVG", `{}`, [][]byte{[]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)}, false},
		{"oversize", `{}`, [][]byte{make([]byte, avatarUploadLimit+1)}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, contentType := kbMultipart(t, tc.metadata, tc.files...)
			req := httptest.NewRequest("POST", "/kb", body)
			req.Header.Set("Content-Type", contentType)
			in, avatar, err := parseKbForm(httptest.NewRecorder(), req)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
			if tc.valid && (in.String("name") != "Example" || avatar == nil) {
				t.Fatal("lost metadata/image")
			}
		})
	}
	for _, input := range []string{`{"name":"JSON"}`, `null`, `{}` + `{}`} {
		req := httptest.NewRequest("POST", "/kb", strings.NewReader(input))
		req.Header.Set("Content-Type", "application/json")
		in, avatar, err := parseKbForm(httptest.NewRecorder(), req)
		if input == `{"name":"JSON"}` {
			if err != nil || avatar != nil || in.String("name") != "JSON" {
				t.Fatalf("JSON compatibility: %v", err)
			}
		} else if err == nil {
			t.Fatal("accepted invalid JSON")
		}
	}
	service := NewService(nil, nil)
	_, err := service.saveWithAvatar(t.Context(), "", "", "", resource.Object{}, &avatarChange{})
	var apiError *resource.Error
	if !errors.As(err, &apiError) || apiError.Status != 503 {
		t.Fatalf("storage unavailable: %v", err)
	}
}

type avatarStorage struct {
	mu    sync.Mutex
	files map[string][]byte
	fail  bool
}

func (s *avatarStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return errors.New("upload failed")
	}
	s.files[key] = bytes.Clone(data)
	return nil
}
func (s *avatarStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.files[key]
	if !ok {
		return nil, errors.New("image missing")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}
func (s *avatarStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, key)
	return nil
}
func (*avatarStorage) Ping(context.Context) error { return nil }
func (s *avatarStorage) count() int               { s.mu.Lock(); defer s.mu.Unlock(); return len(s.files) }
