package kb

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const documentRequestLimit = 100 << 20

// decodeDocumentRequest limits the complete REST JSON body, including metadata.
func decodeDocumentRequest(w http.ResponseWriter, r *http.Request, input *DocumentInput) error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, documentRequestLimit))
	if err != nil {
		var oversized *http.MaxBytesError
		if errors.As(err, &oversized) {
			return &resource.Error{Status: http.StatusRequestEntityTooLarge, Code: "payload_too_large", Message: "文档请求体不能超过 100 MiB"}
		}
		return resource.InvalidCode("invalid_json", "请求格式无效")
	}
	body = bytes.TrimSpace(body)
	if len(body) == 0 || body[0] != '{' {
		return resource.InvalidCode("invalid_json", "请求必须为 JSON 对象")
	}
	if err := json.Unmarshal(body, input); err != nil {
		return resource.InvalidCode("invalid_json", "请求格式无效")
	}
	return nil
}
