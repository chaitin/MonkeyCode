package app

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
)

func TestPlaneIsolation(t *testing.T) {
	for _, tc := range []struct {
		method, path string
		proxy        bool
	}{
		{"POST", "/v1/responses", true},
		{"POST", "/mcp/connectors/x/credentials/y", true},
		{"POST", "/mcp/kb", true},
		{"POST", "/oauth/token", true},
		{"POST", "/api/auth/v1/device/decision", true},
		{"GET", "/api/v1/endpoint-bridge", true},
		{"GET", "/api/v1/endpoints/connect", true},
		{"GET", "/api/v1/endpoints/x/proxy/acp", true},
		{"GET", "/endpoints/x/files/y/file", true},
		{"GET", "/preview/x/y/file", true},
		{"PUT", "/api/v1/sessions/id", true},
		{"POST", "/api/v1/sessions/id/turns", true},
		{"GET", "/api/v1/sessions/id", false},
		{"GET", "/api/v1/models", false},
		{"POST", "/api/v1/api-keys", true},
		{"POST", "/api/v1/api-keys/id/rotate", true},
		{"GET", "/api/admin/v1/api-keys", false},
		{"GET", "/api/v1/connectors/x/tools", false},
		{"GET", "/oauth/connectors/x/callback", false},
		{"GET", "/api/kb/x/assets/y", false},
		{"POST", "/v1/images/edits", false},
		{"POST", "/v1/videos/generations", false},
		{"POST", "/api/admin/v1/environments/123/stop", false},
		{"POST", "/api/admin/v1/system-images/upload", false},
		{"POST", "/api/host/v1/exchange", false},
		{"POST", "/api/auth/v1/profile/password", false},
	} {
		for _, role := range []config.Role{config.RoleControl, config.RoleProxy} {
			called := false
			h := planeHandler(role, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
			if called != ((role == config.RoleProxy) == tc.proxy) || (!called && w.Code != 404) {
				t.Fatalf("%s %s %s: called=%t status=%d", role, tc.method, tc.path, called, w.Code)
			}
		}
	}
}

func TestIngressMatchesExecutionRoutes(t *testing.T) {
	f, err := os.Open("../../../web/nginx.conf")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var routes []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if pattern, ok := strings.CutSuffix(line, " monkeyai_proxy;"); ok && strings.HasPrefix(pattern, "~") {
			routes = append(routes, pattern[1:])
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	want := make([]string, 0, len(executionRoutes))
	for _, route := range executionRoutes {
		want = append(want, route.String())
	}
	if !slices.Equal(routes, want) {
		t.Fatalf("入口和 Go 分流规则不一致：%v", routes)
	}
}
