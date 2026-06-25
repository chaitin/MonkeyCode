package usecase

import (
	"context"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/asseturl"
	"github.com/google/uuid"
)

func TestValidateAttachmentsAllowsEmpty(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	if err := validateAttachments(uuid.Nil, nil, cfg, config.ObjectStorageConfig{}); err != nil {
		t.Fatalf("validateAttachments(nil) error = %v", err)
	}
	if err := validateAttachments(uuid.Nil, []domain.TaskAttachment{}, cfg, config.ObjectStorageConfig{}); err != nil {
		t.Fatalf("validateAttachments(empty) error = %v", err)
	}
}

func TestValidateAttachmentsAllowsConfiguredPrefix(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	err := validateAttachments(uuid.Nil, []domain.TaskAttachment{{URL: "https://oss.example.com/temp/a.txt", Filename: "a.txt"}}, cfg, config.ObjectStorageConfig{})
	if err != nil {
		t.Fatalf("validateAttachments() error = %v", err)
	}
}

func TestValidateAttachmentsAllowsOwnedAssetURL(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	cfg := config.ObjectStorageConfig{Enabled: true, TempPrefix: "tmp/task-attachments"}
	key := "tmp/task-attachments/11111111-1111-1111-1111-111111111111_hash.png"

	err := validateAttachments(userID, []domain.TaskAttachment{{URL: asseturl.Build(key), Filename: "a.png"}}, config.Attachment{}, cfg)
	if err != nil {
		t.Fatalf("validateAttachments() error = %v", err)
	}
}

func TestValidateAttachmentsRejectsOtherUserAssetURL(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	cfg := config.ObjectStorageConfig{Enabled: true, TempPrefix: "tmp/task-attachments"}
	key := "tmp/task-attachments/22222222-2222-2222-2222-222222222222_hash.png"

	err := validateAttachments(userID, []domain.TaskAttachment{{URL: asseturl.Build(key), Filename: "a.png"}}, config.Attachment{}, cfg)
	if err == nil {
		t.Fatal("validateAttachments() error = nil, want error")
	}
}

func TestValidateAttachmentsRejectsAssetURLWhenObjectStorageDisabled(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	key := "tmp/task-attachments/11111111-1111-1111-1111-111111111111_hash.png"

	err := validateAttachments(userID, []domain.TaskAttachment{{URL: asseturl.Build(key), Filename: "a.png"}}, config.Attachment{}, config.ObjectStorageConfig{TempPrefix: "tmp/task-attachments"})
	if err == nil {
		t.Fatal("validateAttachments() error = nil, want error")
	}
}

func TestValidateAttachmentsRejectsBadInputs(t *testing.T) {
	cfg := config.Attachment{AllowedURLPrefixes: []string{"https://oss.example.com/temp/"}}
	cases := [][]domain.TaskAttachment{
		{{URL: "", Filename: "a.txt"}},
		{{URL: "https://oss.example.com/temp/a.txt", Filename: ""}},
		{{URL: "ftp://oss.example.com/temp/a.txt", Filename: "a.txt"}},
		{{URL: "https://evil.example.com/temp/a.txt", Filename: "a.txt"}},
		{
			{URL: "https://oss.example.com/temp/1", Filename: "1"},
			{URL: "https://oss.example.com/temp/2", Filename: "2"},
			{URL: "https://oss.example.com/temp/3", Filename: "3"},
			{URL: "https://oss.example.com/temp/4", Filename: "4"},
			{URL: "https://oss.example.com/temp/5", Filename: "5"},
			{URL: "https://oss.example.com/temp/6", Filename: "6"},
			{URL: "https://oss.example.com/temp/7", Filename: "7"},
			{URL: "https://oss.example.com/temp/8", Filename: "8"},
			{URL: "https://oss.example.com/temp/9", Filename: "9"},
			{URL: "https://oss.example.com/temp/10", Filename: "10"},
			{URL: "https://oss.example.com/temp/11", Filename: "11"},
		},
	}

	for _, attachments := range cases {
		if err := validateAttachments(uuid.Nil, attachments, cfg, config.ObjectStorageConfig{}); err == nil {
			t.Fatalf("validateAttachments(%#v) error = nil, want error", attachments)
		}
	}
}

func TestTaskAttachmentsToTaskflowConvertsAssetURLToHTTPPresignURL(t *testing.T) {
	store := &fakeObjectStore{}
	u := &TaskUsecase{
		cfg:         &config.Config{},
		objectStore: store,
	}
	u.cfg.ObjectStorage.Enabled = true
	got, err := u.taskAttachmentsToTaskflow(context.Background(), []domain.TaskAttachment{
		{URL: asseturl.Build("tmp/task-attachments/11111111-1111-1111-1111-111111111111_hash.png"), Filename: "a.png"},
	})
	if err != nil {
		t.Fatalf("taskAttachmentsToTaskflow() error = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d", len(got))
	}
	wantURL := "http://agent.local/tmp/task-attachments/11111111-1111-1111-1111-111111111111_hash.png"
	if got[0].URL != wantURL {
		t.Fatalf("url = %q, want %q", got[0].URL, wantURL)
	}
	if store.key != "tmp/task-attachments/11111111-1111-1111-1111-111111111111_hash.png" {
		t.Fatalf("key = %q", store.key)
	}
}

func TestTaskAttachmentsToTaskflowKeepsExternalURL(t *testing.T) {
	store := &fakeObjectStore{}
	u := &TaskUsecase{objectStore: store}
	got, err := u.taskAttachmentsToTaskflow(context.Background(), []domain.TaskAttachment{
		{URL: "https://oss.example.com/temp/a.txt", Filename: "a.txt"},
	})
	if err != nil {
		t.Fatalf("taskAttachmentsToTaskflow() error = %v", err)
	}
	if got[0].URL != "https://oss.example.com/temp/a.txt" {
		t.Fatalf("url = %q", got[0].URL)
	}
	if store.key != "" {
		t.Fatalf("store called for http url: %q", store.key)
	}
}

func TestTaskAttachmentsToTaskflowRejectsAssetURLWhenObjectStorageDisabled(t *testing.T) {
	u := &TaskUsecase{objectStore: &fakeObjectStore{}}
	_, err := u.taskAttachmentsToTaskflow(context.Background(), []domain.TaskAttachment{
		{URL: asseturl.Build("tmp/task-attachments/11111111-1111-1111-1111-111111111111_hash.png"), Filename: "a.png"},
	})
	if err == nil {
		t.Fatal("taskAttachmentsToTaskflow() error = nil, want error")
	}
}

type fakeObjectStore struct {
	key     string
	expires time.Duration
}

func (f *fakeObjectStore) GetObject(context.Context, string) (io.ReadCloser, error) {
	return nil, fmt.Errorf("not implemented")
}

func (f *fakeObjectStore) PresignGet(_ context.Context, key string, expires time.Duration) (string, error) {
	f.key = key
	f.expires = expires
	return fmt.Sprintf("http://agent.local/%s", key), nil
}

func (f *fakeObjectStore) PutFile(context.Context, string, string, io.Reader) error {
	return fmt.Errorf("not implemented")
}
