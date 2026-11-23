package app

import (
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func planeHandler(role config.Role, next http.Handler) http.Handler {
	if role == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path != "/healthz" && path != "/readyz" && (role == config.RoleProxy) != executionPath(path) {
			web.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func executionPath(path string) bool {
	switch path {
	case "/.well-known/oauth-authorization-server", "/api/auth/v1/profile/password":
		return true
	}
	for _, prefix := range []string{"/v1", "/v2", "/mcp", "/preview", "/endpoints", "/oauth", "/api/v1", "/api/host", "/api/kb", "/api/auth/v1/device", "/api/auth/v1/client-requests", "/api/admin/v1/environments", "/api/admin/v1/environment-hosts", "/api/admin/v1/environment-images", "/api/admin/v1/engine-hosts", "/api/admin/v1/engine-host-enrollments", "/api/admin/v1/engine-upgrade", "/api/admin/v1/system-images"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}
