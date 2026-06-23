package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type serverConfigProviderStub struct {
	info domain.ServerConfig
}

func (s serverConfigProviderStub) GetServerConfig(context.Context) (domain.ServerConfig, error) {
	return s.info, nil
}

func TestServerRegistersConfigRoute(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue[domain.ServerConfigProvider](injector, serverConfigProviderStub{})

	ProvideServer(injector)
	InvokeServer(injector)

	if !hasRoute(w, http.MethodGet, "/api/v1/server/config") {
		t.Fatal("GET /api/v1/server/config route is not registered")
	}
}

func TestServerSkipsConfigRouteWithoutProvider(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))

	ProvideServer(injector)
	InvokeServer(injector)

	if hasRoute(w, http.MethodGet, "/api/v1/server/config") {
		t.Fatal("GET /api/v1/server/config should not be registered without provider")
	}
}

func TestServerConfigReturnsInjectedProviderInfo(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue[domain.ServerConfigProvider](injector, serverConfigProviderStub{
		info: domain.ServerConfig{
			Edition:        domain.ProductEditionSaaS,
			Region:         domain.ProductRegionCN,
			CurrentVersion: "v1.2.3",
			LatestVersion:  "v1.2.4",
		},
	})

	ProvideServer(injector)
	InvokeServer(injector)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/server/config", nil)
	rec := httptest.NewRecorder()
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body: %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp struct {
		Code    int                 `json:"code"`
		Message string              `json:"message"`
		Data    domain.ServerConfig `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Code != 0 || resp.Message != "success" {
		t.Fatalf("response meta = (%d, %q), want (0, success)", resp.Code, resp.Message)
	}
	if resp.Data.Edition != domain.ProductEditionSaaS || resp.Data.Region != domain.ProductRegionCN {
		t.Fatalf("data = %+v", resp.Data)
	}
	if resp.Data.CurrentVersion != "v1.2.3" || resp.Data.LatestVersion != "v1.2.4" {
		t.Fatalf("versions = (%q, %q), want (v1.2.3, v1.2.4)", resp.Data.CurrentVersion, resp.Data.LatestVersion)
	}
}

func hasRoute(w *web.Web, method, path string) bool {
	for _, route := range w.Routes() {
		if route.Method == method && route.Path == path {
			return true
		}
	}
	return false
}
