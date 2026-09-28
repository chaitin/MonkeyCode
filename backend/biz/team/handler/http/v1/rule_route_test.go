package v1

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/GoYoko/web"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
)

func TestNewTeamRuleHandlerRegistersRoutes(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, &middleware.AuditMiddleware{})
	do.ProvideValue[domain.TeamRuleUsecase](injector, &teamRuleUsecaseStub{})
	do.ProvideValue[domain.TeamGroupUserRepo](injector, &teamRuleRepoStub{role: consts.TeamMemberRoleAdmin})

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

func TestTeamRuleListRequiresAdmin(t *testing.T) {
	tests := []struct {
		name       string
		role       consts.TeamMemberRole
		wantStatus int
		wantCalls  int
	}{
		{name: "member", role: consts.TeamMemberRoleUser, wantStatus: http.StatusForbidden},
		{name: "admin", role: consts.TeamMemberRoleAdmin, wantStatus: http.StatusOK, wantCalls: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := web.New()
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			mr := miniredis.RunT(t)
			port, err := strconv.Atoi(mr.Port())
			if err != nil {
				t.Fatal(err)
			}
			cfg := &config.Config{}
			cfg.Redis.Host = "127.0.0.1"
			cfg.Redis.Port = port
			cfg.Session.ExpireDay = 1
			sess := session.New(cfg)
			usecase := &teamRuleUsecaseStub{}
			repo := &teamRuleRepoStub{role: tt.role}

			injector := do.New()
			do.ProvideValue(injector, w)
			do.ProvideValue(injector, middleware.NewAuthMiddleware(sess, nil, logger))
			do.ProvideValue(injector, middleware.NewAuditMiddleware(logger, nil, nil))
			do.ProvideValue[domain.TeamRuleUsecase](injector, usecase)
			do.ProvideValue[domain.TeamGroupUserRepo](injector, repo)
			if _, err := NewTeamRuleHandler(injector); err != nil {
				t.Fatal(err)
			}

			userID := uuid.New()
			teamID := uuid.New()
			saveReq := httptest.NewRequest(http.MethodGet, "/", nil)
			saveRec := httptest.NewRecorder()
			saveCtx := w.Echo().NewContext(saveReq, saveRec)
			if _, err := sess.Save(saveCtx, consts.MonkeyCodeAITeamSession, userID, &domain.User{
				ID:   userID,
				Team: &domain.Team{ID: teamID},
			}); err != nil {
				t.Fatal(err)
			}

			req := httptest.NewRequest(http.MethodGet, "/api/v1/teams/rules", nil)
			for _, cookie := range saveRec.Result().Cookies() {
				req.AddCookie(cookie)
			}
			rec := httptest.NewRecorder()
			w.Echo().ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if usecase.listCalls != tt.wantCalls {
				t.Fatalf("list calls = %d, want %d", usecase.listCalls, tt.wantCalls)
			}
		})
	}
}

type teamRuleUsecaseStub struct {
	domain.TeamRuleUsecase
	listCalls int
}

func (s *teamRuleUsecaseStub) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamRulesResp, error) {
	s.listCalls++
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

type teamRuleRepoStub struct {
	domain.TeamGroupUserRepo
	role consts.TeamMemberRole
}

func (s *teamRuleRepoStub) GetMember(context.Context, uuid.UUID, uuid.UUID) (*db.TeamMember, error) {
	return &db.TeamMember{Role: s.role}, nil
}
