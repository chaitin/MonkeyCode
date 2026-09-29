package feedback

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"sync"
	"testing"
)

type memoryStorage struct {
	mu   sync.Mutex
	data map[string][]byte
}

func newMemoryStorage() *memoryStorage {
	return &memoryStorage{data: make(map[string][]byte)}
}

func (s *memoryStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[key] = bytes.Clone(data)
	return nil
}

func (s *memoryStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, ok := s.data[key]
	if !ok {
		return nil, io.EOF
	}
	return io.NopCloser(bytes.NewReader(bytes.Clone(data))), nil
}

func (s *memoryStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, key)
	return nil
}

func (s *memoryStorage) Ping(context.Context) error { return nil }

func TestMemoryStorageRoundTrip(t *testing.T) {
	storage := newMemoryStorage()
	want := []byte("feedback")
	if err := storage.Put(context.Background(), "key", want, "text/plain"); err != nil {
		t.Fatal(err)
	}
	reader, err := storage.Get(context.Background(), "key")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	got, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("storage data = %q, want %q", got, want)
	}
}

func TestDecodeImageUsesContent(t *testing.T) {
	imageData := newPNG(t, 2, 3)
	got, err := decodeImage(imageData)
	if err != nil {
		t.Fatal(err)
	}
	if got.Format != "png" || got.MIMEType != "image/png" || got.Width != 2 || got.Height != 3 {
		t.Fatalf("decoded image = %+v", got)
	}
	if got.SHA256 != sha256Hex(imageData) {
		t.Fatal("decoded image hash mismatch")
	}
}

func TestDecodeImageRejectsSVG(t *testing.T) {
	if _, err := decodeImage([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)); err == nil {
		t.Fatal("SVG was accepted")
	}
}

func TestValidateRequestRequiresContentOrImage(t *testing.T) {
	err := validateRequest("user", Request{Category: "bug", Platform: "web"})
	if err == nil {
		t.Fatal("empty feedback was accepted")
	}
}

func newPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x + 1), G: uint8(y + 1), A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
