package kb

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type documentPaddingReader struct{}

func (documentPaddingReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = ' '
	}
	return len(p), nil
}

func TestDecodeDocumentRequest(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `{} {}`, `{"content":1}`, `{"content":`} {
		var input DocumentInput
		if err := decodeDocumentRequest(httptest.NewRecorder(), httptest.NewRequest("POST", "/", strings.NewReader(raw)), &input); err == nil {
			t.Fatalf("accepted invalid JSON: %s", raw)
		}
	}
	content := strings.Repeat("a", 20<<20)
	var input DocumentInput
	req := httptest.NewRequest("POST", "/", io.MultiReader(strings.NewReader(`{"content":"`), strings.NewReader(content), strings.NewReader(`"}`)))
	if err := decodeDocumentRequest(httptest.NewRecorder(), req, &input); err != nil || input.Content != content {
		t.Fatalf("20 MiB document: %v", err)
	}
	for _, extra := range []int64{0, 1} {
		body := io.MultiReader(strings.NewReader(`{}`), io.LimitReader(documentPaddingReader{}, documentRequestLimit-2+extra))
		req := httptest.NewRequest("PUT", "/", body)
		err := decodeDocumentRequest(httptest.NewRecorder(), req, &DocumentInput{})
		if extra == 0 && err != nil {
			t.Fatalf("exact limit rejected: %v", err)
		}
		if extra == 1 && (err == nil || resource.AsError(err).Status != 413) {
			t.Fatalf("oversize error: %v", err)
		}
	}
}
