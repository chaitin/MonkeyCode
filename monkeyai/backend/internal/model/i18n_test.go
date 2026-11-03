package model

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func TestLegacyModelErrorUsesNegotiatedResponseLanguage(t *testing.T) {
	r := httptest.NewRequest("POST", "/models", nil)
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	web.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		modelError(r.Context(), w, 400, "enabled 必须是布尔值")
	})).ServeHTTP(w, r)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "model_error") || !strings.Contains(w.Body.String(), "enabled must be a boolean") {
		t.Fatalf("模型错误丢失具体原因或语言: %s", w.Body.String())
	}
}
