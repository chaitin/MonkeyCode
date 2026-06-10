package v1

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func TestNewTeamOIDCHandlerRegistersRoutes(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue[domain.TeamOIDCUsecase](injector, &teamOIDCUsecaseStub{})
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, middleware.NewTargetActiveMiddleware(slog.New(slog.NewTextHandler(io.Discard, nil)), nil))

	if _, err := NewTeamOIDCHandler(injector); err != nil {
		t.Fatal(err)
	}

	want := map[string]bool{
		"GET /api/v1/teams/oidc":       false,
		"PUT /api/v1/teams/oidc":       false,
		"POST /api/v1/teams/oidc/test": false,
	}
	for _, route := range w.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for key, ok := range want {
		if !ok {
			t.Fatalf("route %s is not registered", key)
		}
	}
}

type teamOIDCUsecaseStub struct {
	domain.TeamOIDCUsecase
}

func (s *teamOIDCUsecaseStub) GetConfig(ctx context.Context, teamUser *domain.TeamUser) (*domain.TeamOIDCConfigResp, error) {
	return &domain.TeamOIDCConfigResp{}, nil
}
