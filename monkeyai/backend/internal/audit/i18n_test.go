package audit

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func TestAuditFailureUsesSharedTranslation(t *testing.T) {
	r := httptest.NewRequest("GET", "/operation-logs", nil)
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	web.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		failure(r.Context(), w, 400, "invalid_request", "筛选时间需使用带时区的 ISO 格式")
	})).ServeHTTP(w, r)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "invalid_request") || !strings.Contains(w.Body.String(), "ISO format with a time zone") {
		t.Fatalf("审计错误未准确翻译: %s", w.Body.String())
	}
}
