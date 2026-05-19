package v1

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
)

func TestNewAuthHandlerRegistersMembersRoute(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, &config.Config{})
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue(injector, (*redis.Client)(nil))
	do.ProvideValue[domain.UserUsecase](injector, &membersUserUsecaseStub{})
	do.ProvideValue[domain.TeamGroupUserUsecase](injector, &membersTeamUsecaseStub{})
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, middleware.NewTargetActiveMiddleware(slog.New(slog.NewTextHandler(io.Discard, nil)), nil))
	do.ProvideValue(injector, captcha.NewCaptcha())

	if _, err := NewAuthHandler(injector); err != nil {
		t.Fatal(err)
	}

	for _, route := range w.Routes() {
		if route.Method == "GET" && route.Path == "/api/v1/users/members" {
			return
		}
	}
	t.Fatal("GET /api/v1/users/members route is not registered")
}

type membersUserUsecaseStub struct {
	domain.UserUsecase
}

func (s *membersUserUsecaseStub) GetUserWithTeams(ctx context.Context, userID uuid.UUID) (*domain.TeamUserInfo, error) {
	return &domain.TeamUserInfo{}, nil
}

type membersTeamUsecaseStub struct {
	domain.TeamGroupUserUsecase
}

func (s *membersTeamUsecaseStub) MemberList(ctx context.Context, teamUser *domain.TeamUser, req *domain.MemberListReq) (*domain.MemberListResp, error) {
	return &domain.MemberListResp{}, nil
}
