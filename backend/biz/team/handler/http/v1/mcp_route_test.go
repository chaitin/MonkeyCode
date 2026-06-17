package v1

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func TestNewTeamMCPHandlerRegistersRoutes(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, &middleware.AuditMiddleware{})
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue[domain.TeamMCPUsecase](injector, &teamMCPUsecaseStub{})
	do.ProvideValue[domain.TeamMCPRepo](injector, &teamMCPRepoStub{})

	if _, err := NewTeamMCPHandler(injector); err != nil {
		t.Fatal(err)
	}

	want := map[string]bool{
		"GET /api/v1/teams/mcp/upstreams":                    false,
		"POST /api/v1/teams/mcp/upstreams":                   false,
		"PUT /api/v1/teams/mcp/upstreams/:upstream_id":       false,
		"DELETE /api/v1/teams/mcp/upstreams/:upstream_id":    false,
		"POST /api/v1/teams/mcp/upstreams/:upstream_id/sync": false,
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

type teamMCPUsecaseStub struct {
	domain.TeamMCPUsecase
}

type teamMCPRepoStub struct {
	domain.TeamMCPRepo
}

func (s *teamMCPRepoStub) GetMember(context.Context, uuid.UUID, uuid.UUID) (*domain.TeamMember, error) {
	return &domain.TeamMember{}, nil
}
