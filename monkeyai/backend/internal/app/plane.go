package app

import (
	"net/http"
	"regexp"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
)

func planeHandler(role config.Role, next http.Handler) http.Handler {
	if role == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path != "/healthz" && path != "/readyz" && (role == config.RoleProxy) != executionRoute(r.Method, path) {
			web.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// 与 web/nginx.conf 的分流清单保持一致。
var executionRoutes = []*regexp.Regexp{
	regexp.MustCompile(`^[^:]+:/v1/(?:chat/completions|responses|messages)$`),
	regexp.MustCompile(`^[^:]+:/mcp/(?:kb|connectors/[^/]+(?:/credentials/[^/]+)?)$`),
	regexp.MustCompile(`^(?:PUT:/api/v1/sessions/[^/]+|POST:/api/v1/sessions/[^/]+/turns)$`),
	regexp.MustCompile(`^[^:]+:/api/v1/api-keys(?:/[^/]+(?:/rotate)?)?$`),
	regexp.MustCompile(`^[^:]+:/(?:preview/[^/]+/[^/]+/|endpoints/[^/]+/files/[^/]+/)`),
	regexp.MustCompile(`^[^:]+:/api/v1/(?:endpoint-bridge$|endpoints(?:/?$|/[^/]+(?:$|/(?:connections|revoke|restore)$|/proxy/)))`),
	regexp.MustCompile(`^[^:]+:/(?:[.]well-known/oauth-authorization-server$|oauth/(?:authorize$|token$|revoke$|device/authorization$|pairing(?:/|$)))`),
	regexp.MustCompile(`^[^:]+:/api/auth/v1/(?:device/decision|client-requests/[^/]+(?:/complete)?)$`),
}

func executionRoute(method, path string) bool {
	for _, route := range executionRoutes {
		if route.MatchString(method + ":" + path) {
			return true
		}
	}
	return false
}
