package mcphub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestHandlerRegistersMCPHubRoutes(t *testing.T) {
	w := web.New()
	cfg := &config.Config{}
	cfg.MCPHub.Token = "secret"
	handler := NewHandler(w, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), &syncerStub{})

	handler.RegisterRoutes()

	want := map[string]bool{
		"GET /mcp":                          false,
		"POST /mcp":                         false,
		"DELETE /mcp":                       false,
		"POST /internal/upstreams/:id/sync": false,
	}
	for _, route := range w.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for route, found := range want {
		if !found {
			t.Fatalf("route %s is not registered", route)
		}
	}
}

func TestSyncUpstreamRequiresInternalToken(t *testing.T) {
	w := web.New()
	cfg := &config.Config{}
	cfg.MCPHub.Token = "secret"
	syncer := &syncerStub{}
	handler := NewHandler(w, cfg, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), syncer)
	handler.RegisterRoutes()

	upstreamID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/internal/upstreams/"+upstreamID.String()+"/sync", nil)
	rec := httptest.NewRecorder()
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if syncer.called {
		t.Fatal("syncer should not be called without token")
	}

	req = httptest.NewRequest(http.MethodPost, "/internal/upstreams/"+upstreamID.String()+"/sync", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !syncer.called || syncer.id != upstreamID {
		t.Fatalf("syncer called=%v id=%s, want %s", syncer.called, syncer.id, upstreamID)
	}
}

type syncerStub struct {
	called bool
	id     uuid.UUID
}

func (s *syncerStub) Sync(_ context.Context, id uuid.UUID) error {
	s.called = true
	s.id = id
	return nil
}
