package v1

import (
	"context"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func TestNewTeamRuleHandlerRegistersRoutes(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, &middleware.AuditMiddleware{})
	do.ProvideValue[domain.TeamRuleUsecase](injector, &teamRuleUsecaseStub{})

	if _, err := NewTeamRuleHandler(injector); err != nil {
		t.Fatal(err)
	}

	want := map[string]bool{
		"GET /api/v1/teams/rules":                   false,
		"POST /api/v1/teams/rules":                  false,
		"PUT /api/v1/teams/rules/:rule_id":          false,
		"PUT /api/v1/teams/rules/:rule_id/enabled":  false,
		"DELETE /api/v1/teams/rules/:rule_id":       false,
		"GET /api/v1/teams/rules/:rule_id/versions": false,
		"POST /api/v1/teams/rules/:rule_id/restore": false,
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

type teamRuleUsecaseStub struct {
	domain.TeamRuleUsecase
}

func (s *teamRuleUsecaseStub) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamRulesResp, error) {
	return &domain.ListTeamRulesResp{}, nil
}

func (s *teamRuleUsecaseStub) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamRuleReq) (*domain.TeamRule, error) {
	return &domain.TeamRule{ID: uuid.New()}, nil
}

func (s *teamRuleUsecaseStub) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamRuleReq) (*domain.TeamRule, error) {
	return &domain.TeamRule{ID: req.RuleID}, nil
}

func (s *teamRuleUsecaseStub) SetEnabled(ctx context.Context, teamUser *domain.TeamUser, req *domain.SetTeamRuleEnabledReq) (*domain.TeamRule, error) {
	return &domain.TeamRule{ID: req.RuleID, Enabled: req.Enabled}, nil
}

func (s *teamRuleUsecaseStub) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamRuleReq) error {
	return nil
}

func (s *teamRuleUsecaseStub) ListVersions(ctx context.Context, teamUser *domain.TeamUser, req *domain.ListTeamRuleVersionsReq) (*domain.ListTeamRuleVersionsResp, error) {
	return &domain.ListTeamRuleVersionsResp{}, nil
}

func (s *teamRuleUsecaseStub) Restore(ctx context.Context, teamUser *domain.TeamUser, req *domain.RestoreTeamRuleReq) (*domain.TeamRule, error) {
	return &domain.TeamRule{ID: req.RuleID}, nil
}
