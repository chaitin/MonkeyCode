package resource

import (
	"encoding/json"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAllocateIDs(t *testing.T) {
	router := chi.NewRouter()
	new(Store).RegisterAdmin(router)
	seen := map[string]bool{}
	pattern := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	for range 2 {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/identifiers", strings.NewReader(`{"count":1000}`)))
		if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("分配失败: %d %s", response.Code, response.Body.String())
		}
		var out struct {
			IDs []string `json:"ids"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil || len(out.IDs) != 1000 {
			t.Fatalf("标识数量错误: %d %v", len(out.IDs), err)
		}
		for _, id := range out.IDs {
			if !pattern.MatchString(id) || seen[id] {
				t.Fatalf("标识格式错误或重复: %s", id)
			}
			seen[id] = true
		}
	}
	for _, body := range []string{`{}`, `{"count":0}`, `{"count":-1}`, `{"count":1001}`, `{"count":1.5}`, `{"count":"1"}`, `null`} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/identifiers", strings.NewReader(body)))
		if response.Code != 400 {
			t.Errorf("无效请求应返回 400: %s: %d", body, response.Code)
		}
	}
}
