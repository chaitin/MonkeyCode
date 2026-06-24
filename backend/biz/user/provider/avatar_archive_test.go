package provider

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestAvatarArchiverUploadsImageToObjectStorage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("png-data"))
	}))
	defer server.Close()
	store := &avatarObjectStoreStub{}
	archiver := NewAvatarArchiver(config.ObjectStorageConfig{
		Enabled:      true,
		AvatarPrefix: "avatar",
	}, server.Client(), store)

	got, err := archiver.Archive(context.Background(), Google, "google-sub-1", server.URL+"/avatar.png")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://oss.example.com/avatar/oauth/google/google-sub-1.png" {
		t.Fatalf("url = %q", got)
	}
	if store.prefix != "avatar/oauth/google" || store.filename != "google-sub-1.png" {
		t.Fatalf("object = %s/%s", store.prefix, store.filename)
	}
	if string(store.body) != "png-data" {
		t.Fatalf("body = %q", string(store.body))
	}
}

func TestAvatarArchiverReportsInvalidOrNonImageURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("not image"))
	}))
	defer server.Close()
	store := &avatarObjectStoreStub{}
	archiver := NewAvatarArchiver(config.ObjectStorageConfig{
		Enabled:      true,
		AvatarPrefix: "avatar",
	}, server.Client(), store)

	tests := []struct {
		raw     string
		wantErr string
	}{
		{raw: "ftp://example.com/a.png", wantErr: "invalid avatar url"},
		{raw: server.URL + "/avatar.txt", wantErr: "avatar content type is not image"},
	}
	for _, tt := range tests {
		raw := tt.raw
		got, err := archiver.Archive(context.Background(), Github, "123", raw)
		if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
			t.Fatalf("Archive(%q) error = %v, want containing %q", raw, err, tt.wantErr)
		}
		if got != "" {
			t.Fatalf("Archive(%q) = %q, want empty", raw, got)
		}
	}
	if store.putCount != 0 {
		t.Fatalf("put count = %d, want 0", store.putCount)
	}
}

type avatarObjectStoreStub struct {
	prefix   string
	filename string
	body     []byte
	putCount int
}

func (s *avatarObjectStoreStub) PutFile(_ context.Context, prefix, filename string, r io.Reader) error {
	body, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.prefix = prefix
	s.filename = filename
	s.body = body
	s.putCount++
	return nil
}

func (s *avatarObjectStoreStub) GetURL(prefix, filename string) string {
	return "https://oss.example.com/" + prefix + "/" + filename
}
