package endpoint

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func TestEndpointFailuresUseSharedTranslations(t *testing.T) {
	var frame []byte
	handler := web.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		failure(r.Context(), w, 404, "endpoint_not_found")
		var err error
		frame, err = errorFrame(r.Context(), "target_busy", "reply-123")
		if err != nil {
			t.Error(err)
		}
	}))
	r := httptest.NewRequest("GET", "/endpoints/invalid", nil)
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 404 || !strings.Contains(w.Body.String(), "endpoint_not_found") || !strings.Contains(w.Body.String(), "endpoint does not exist") {
		t.Fatalf("HTTP错误未翻译: %s", w.Body.String())
	}
	var decoded map[string]any
	if json.Unmarshal(frame, &decoded) != nil || !strings.Contains(string(frame), "busy") || !strings.Contains(string(frame), "reply-123") {
		t.Fatalf("设备错误帧未翻译或结构变化: %s", frame)
	}
}
