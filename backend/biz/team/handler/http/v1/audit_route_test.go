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

func TestNewAuditHandlerRegistersListRoute(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue[domain.AuditUsecase](injector, &auditUsecaseStub{})
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, middleware.NewTargetActiveMiddleware(slog.New(slog.NewTextHandler(io.Discard, nil)), nil))

	if _, err := NewAuditHandler(injector); err != nil {
		t.Fatal(err)
	}

	for _, route := range w.Routes() {
		if route.Method == "GET" && route.Path == "/api/v1/teams/audits" {
			return
		}
	}
	t.Fatal("GET /api/v1/teams/audits route is not registered")
}

type auditUsecaseStub struct {
	domain.AuditUsecase
}

func (s *auditUsecaseStub) ListAudits(ctx context.Context, teamUser *domain.TeamUser, req *domain.ListAuditsRequest) (*domain.ListAuditsResponse, error) {
	return &domain.ListAuditsResponse{}, nil
}
