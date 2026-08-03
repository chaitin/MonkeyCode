package v1

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/GoYoko/web"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/captcha"
)

func TestTeamLoginCaptchaToggle(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		wantErr error
		called  bool
	}{
		{name: "enabled", enabled: true, wantErr: errcode.ErrForbidden},
		{name: "disabled", enabled: false, wantErr: errcode.ErrLoginFailed, called: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usecase := &teamLoginUsecaseStub{}
			h := &TeamGroupUserHandler{
				config:  &config.Config{Security: config.Security{LoginCaptchaEnabled: tt.enabled}},
				logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
				usecase: usecase,
				captcha: captcha.NewCaptcha(),
			}

			err := h.Login(teamTestWebContext(), domain.TeamLoginReq{})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Login() error = %v, want %v", err, tt.wantErr)
			}
			if usecase.called != tt.called {
				t.Fatalf("Login usecase called = %v, want %v", usecase.called, tt.called)
			}
		})
	}
}

func teamTestWebContext() *web.Context {
	e := echo.New()
	req := httptest.NewRequest("POST", "/", nil)
	return &web.Context{Context: e.NewContext(req, httptest.NewRecorder())}
}

type teamLoginUsecaseStub struct {
	domain.TeamGroupUserUsecase
	called bool
}

func (s *teamLoginUsecaseStub) Login(context.Context, *domain.TeamLoginReq) (*domain.User, error) {
	s.called = true
	return nil, errors.New("login failed")
}
