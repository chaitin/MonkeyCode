package v1

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
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
				config:  &config.Config{Security: config.Security{CaptchaEnabled: tt.enabled}},
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

func TestTeamLoginAcceptsEmptyCaptchaTokenWhenDisabled(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "missing", body: `{"email":"admin@example.com","password":"password"}`},
		{name: "empty", body: `{"email":"admin@example.com","password":"password","captcha_token":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usecase := &teamLoginUsecaseStub{}
			h := &TeamGroupUserHandler{
				config:  &config.Config{Security: config.Security{CaptchaEnabled: false}},
				logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
				usecase: usecase,
				captcha: captcha.NewCaptcha(),
			}
			w := web.New()
			w.POST("/login", web.BindHandler(h.Login))

			req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewBufferString(tt.body))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			w.Echo().ServeHTTP(httptest.NewRecorder(), req)

			if !usecase.called {
				t.Fatal("Login usecase was not called")
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
