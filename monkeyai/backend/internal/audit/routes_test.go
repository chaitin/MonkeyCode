package audit

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestModelDiscoveryAuditAction(t *testing.T) {
	for _, tc := range []struct{ path, action string }{
		{"/api/admin/v1/models/discover", "discover"},
		{"/api/admin/v1/models", "create"},
	} {
		t.Run(tc.action, func(t *testing.T) {
			router := chi.NewRouter()
			router.Post(tc.path, func(w http.ResponseWriter, r *http.Request) {
				event := routeEvent(r)
				if event.Action != tc.action || event.Category != "model" || event.TargetType != "model" {
					t.Fatalf("模型查询不能被记为创建模型: %+v", event)
				}
			})
			router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", tc.path, nil))
		})
	}
}
