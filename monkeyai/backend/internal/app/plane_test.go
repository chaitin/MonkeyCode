package app

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlaneIsolation(t *testing.T) {
	for path, want := range map[string]config.Role{"/api/admin/v1/users": config.RoleControl, "/api/admin/v1/environments-other": config.RoleControl, "/api/auth/v1/admin/login": config.RoleControl, "/api/admin/v1/environments/123/stop": config.RoleProxy, "/v1/responses": config.RoleProxy, "/mcp/tools": config.RoleProxy, "/oauth/token": config.RoleProxy, "/api/v1/endpoint-bridge": config.RoleProxy, "/api/host/v1/exchange": config.RoleProxy} {
		for _, role := range []config.Role{config.RoleControl, config.RoleProxy} {
			called := false
			h := planeHandler(role, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
			if called != (role == want) || (!called && w.Code != 404) {
				t.Fatalf("%s %s: called=%t status=%d", role, path, called, w.Code)
			}
		}
	}
}
