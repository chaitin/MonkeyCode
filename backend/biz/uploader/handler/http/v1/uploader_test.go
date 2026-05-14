package v1

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/oss"
	"github.com/google/uuid"
)

func TestPresignFilenameKeepsLowercaseExtension(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	got, err := presignFilename(userID, "archive.ZIP")
	if err != nil {
		t.Fatal(err)
	}
	want := "11111111-1111-1111-1111-111111111111_670070ac98fc89f453cdd612492fc0df.zip"
	if got != want {
		t.Fatalf("filename = %q, want %q", got, want)
	}
}

func TestAllowedExtensionAllowsMarkdown(t *testing.T) {
	if !allowedExtension(".MD") {
		t.Fatal("expected .MD allowed")
	}
}

func TestAllowedExtensionRejectsScript(t *testing.T) {
	if allowedExtension(".sh") {
		t.Fatal("expected .sh rejected")
	}
}

func TestParsePresignExpiresDefaultsToSevenDays(t *testing.T) {
	got := parsePresignExpires("")
	if got != 7*24*time.Hour {
		t.Fatalf("expires = %s", got)
	}
}

func TestParsePresignExpiresClampsToSevenDays(t *testing.T) {
	got := parsePresignExpires("240h")
	if got != 7*24*time.Hour {
		t.Fatalf("expires = %s", got)
	}
}

func TestUploadPrefixSelectsRepoPrefix(t *testing.T) {
	h := &UploaderHandler{cfg: &config.Config{}}
	h.cfg.ObjectStorage.RepoPrefix = "repo"
	got, err := h.uploadPrefix(consts.UploadUsageRepo)
	if err != nil {
		t.Fatal(err)
	}
	if got != "repo" {
		t.Fatalf("prefix = %q", got)
	}
}

func TestRequestObjectStorageClientUsesConfiguredAccessEndpoint(t *testing.T) {
	h := &UploaderHandler{cfg: &config.Config{}}
	h.cfg.ObjectStorage.AccessEndpoint = "https://monkeycode.example.com/oss"
	h.cfg.ObjectStorage.Bucket = "monkeycode-private"
	client, err := oss.NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        "http://internal:9000",
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "monkeycode-private",
	}, oss.S3Option{ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	h.client = client
	req := httptest.NewRequest("POST", "http://internal:8888/api/v1/uploader/presign", nil)

	got := h.requestClient(req).GetURL("tmp", "a.txt")
	if got != "https://monkeycode.example.com/oss/monkeycode-private/tmp/a.txt" {
		t.Fatalf("url = %q", got)
	}
}
