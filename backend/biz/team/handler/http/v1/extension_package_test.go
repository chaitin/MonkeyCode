package v1

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestTeamExtensionPackageHandlerReadPackageFileUsesConfiguredLimit(t *testing.T) {
	h := &TeamExtensionPackageHandler{
		cfg: &config.Config{},
	}
	h.cfg.ObjectStorage.MaxSize = 3
	file := makeMultipartFileHeader(t, "extension.zip", "abcd")

	if _, err := h.readPackageFile(file); err == nil {
		t.Fatal("expected file size limit error")
	}
}

func makeMultipartFileHeader(t *testing.T, filename, content string) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if err := req.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	return req.MultipartForm.File["file"][0]
}
