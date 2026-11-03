package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func TestOAuthErrorDescriptionsAreLocalized(t *testing.T) {
	service := &Service{}
	r := httptest.NewRequest("POST", "/oauth/token", nil)
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	web.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		service.writeOAuthError(r.Context(), w, oauthError("invalid_grant", "授权码已被使用"))
	})).ServeHTTP(w, r)
	var body map[string]any
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || w.Code != 400 || body["error"] != "invalid_grant" || !strings.HasPrefix(body["error_description"].(string), "The authorization code has already been used. [trace_id: ") {
		t.Fatalf("OAuth 错误未翻译或结构变化: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "reason") {
		t.Fatal("引入了额外原因字段")
	}
}
