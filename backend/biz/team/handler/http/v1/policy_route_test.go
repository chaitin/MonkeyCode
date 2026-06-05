package v1

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func TestNewTeamPolicyHandlerRegistersRoutes(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue(injector, &config.Config{})
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, &middleware.AuditMiddleware{})
	do.ProvideValue[domain.TeamPolicyUsecase](injector, &teamPolicyUsecaseStub{})
	do.ProvideValue[domain.TeamPolicyRepo](injector, &teamPolicyRepoStub{})

	if _, err := NewTeamPolicyHandler(injector); err != nil {
		t.Fatal(err)
	}

	want := map[string]bool{
		"GET /api/v1/teams/task-vm-idle-policy": false,
		"PUT /api/v1/teams/task-vm-idle-policy": false,
	}
	for _, route := range w.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for route, ok := range want {
		if !ok {
			t.Fatalf("%s route is not registered", route)
		}
	}
}

type teamPolicyUsecaseStub struct {
	domain.TeamPolicyUsecase
}

func (s *teamPolicyUsecaseStub) GetTaskVMIdlePolicy(ctx context.Context, teamUser *domain.TeamUser) (*domain.TeamTaskVMIdlePolicy, error) {
	return &domain.TeamTaskVMIdlePolicy{}, nil
}

func (s *teamPolicyUsecaseStub) UpdateTaskVMIdlePolicy(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamTaskVMIdlePolicyReq) (*domain.TeamTaskVMIdlePolicy, error) {
	return &domain.TeamTaskVMIdlePolicy{}, nil
}

type teamPolicyRepoStub struct {
	domain.TeamPolicyRepo
}

func (s *teamPolicyRepoStub) GetMember(ctx context.Context, teamID, userID uuid.UUID) (*db.TeamMember, error) {
	return &db.TeamMember{Role: consts.TeamMemberRoleAdmin}, nil
}
