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
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
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

func TestTeamMCPListUpstreamsRequiresAdmin(t *testing.T) {
	tests := []struct {
		name       string
		role       consts.TeamMemberRole
		wantStatus int
		wantCalls  int
	}{
		{name: "普通成员", role: consts.TeamMemberRoleUser, wantStatus: http.StatusForbidden},
		{name: "管理员", role: consts.TeamMemberRoleAdmin, wantStatus: http.StatusOK, wantCalls: 1},
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
			usecase := &teamMCPUsecaseStub{}
			repo := &teamMCPRepoStub{role: tt.role}

			injector := do.New()
			do.ProvideValue(injector, w)
			do.ProvideValue(injector, middleware.NewAuthMiddleware(sess, nil, logger))
			do.ProvideValue(injector, middleware.NewAuditMiddleware(logger, nil, nil))
			do.ProvideValue[domain.TeamMCPUsecase](injector, usecase)
			do.ProvideValue[domain.TeamMCPRepo](injector, repo)
			if _, err := NewTeamMCPHandler(injector); err != nil {
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

			req := httptest.NewRequest(http.MethodGet, "/api/v1/teams/mcp/upstreams", nil)
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

type teamMCPUsecaseStub struct {
	domain.TeamMCPUsecase
	listCalls int
}

func (s *teamMCPUsecaseStub) ListUpstreams(context.Context, *domain.TeamUser) (*domain.ListTeamMCPUpstreamsResp, error) {
	s.listCalls++
	return &domain.ListTeamMCPUpstreamsResp{}, nil
}

type teamMCPRepoStub struct {
	domain.TeamMCPRepo
	role consts.TeamMemberRole
}

func (s *teamMCPRepoStub) GetMember(context.Context, uuid.UUID, uuid.UUID) (*domain.TeamMember, error) {
	return &domain.TeamMember{TeamRole: s.role}, nil
}
