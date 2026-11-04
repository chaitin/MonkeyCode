package setting

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func TestSettingsErrorUsesSharedTranslation(t *testing.T) {
	r := httptest.NewRequest("POST", "/settings", nil)
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	web.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		settingError(r.Context(), w, 400, "收件邮箱无效")
	})).ServeHTTP(w, r)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "setting_error") || !strings.Contains(w.Body.String(), "recipient email address is invalid") {
		t.Fatalf("设置错误未准确翻译: %s", w.Body.String())
	}
}
