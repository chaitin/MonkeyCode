package designcatalog

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func TestDesignErrorEnvelopesAreLocalized(t *testing.T) {
	for _, control := range []bool{true, false} {
		r := httptest.NewRequest("GET", "/api/v1/design-resources/config", nil)
		r.Header.Set("Accept-Language", "en-US")
		w := httptest.NewRecorder()
		web.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			err := fault(404, "snapshot_not_found", "尚未导入设计快照")
			if control {
				controlError(w, r, err)
			} else {
				writeAPIError(w, r, err)
			}
		})).ServeHTTP(w, r)
		var body map[string]any
		if json.Unmarshal(w.Body.Bytes(), &body) != nil || w.Code != 404 || !strings.Contains(w.Body.String(), "No design snapshot has been imported") {
			t.Fatalf("错误未本地化: %s", w.Body.String())
		}
		if control {
			if body["error"].(map[string]any)["code"] != "snapshot_not_found" {
				t.Fatal("控制面错误结构变化")
			}
		} else {
			if body["code"] != "snapshot_not_found" || body["data"] != nil {
				t.Fatal("目录错误结构变化")
			}
			vary := strings.Join(w.Header().Values("Vary"), ",")
			if !strings.Contains(vary, "Accept-Language") || !strings.Contains(vary, "Authorization") {
				t.Fatalf("Vary 丢失: %v", w.Header())
			}
		}
	}
}
