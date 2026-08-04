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

func TestPasswordLoginCaptchaToggle(t *testing.T) {
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
			usecase := &passwordLoginUsecaseStub{}
			h := &AuthHandler{
				config:  &config.Config{Security: config.Security{CaptchaEnabled: tt.enabled}},
				logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
				usecase: usecase,
				captcha: captcha.NewCaptcha(),
			}

			err := h.PasswordLogin(testWebContext(), domain.TeamLoginReq{})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("PasswordLogin() error = %v, want %v", err, tt.wantErr)
			}
			if usecase.called != tt.called {
				t.Fatalf("PasswordLogin usecase called = %v, want %v", usecase.called, tt.called)
			}
		})
	}
}

func TestPasswordLoginAcceptsEmptyCaptchaTokenWhenDisabled(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "missing", body: `{"email":"user@example.com","password":"password"}`},
		{name: "empty", body: `{"email":"user@example.com","password":"password","captcha_token":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usecase := &passwordLoginUsecaseStub{}
			h := &AuthHandler{
				config:  &config.Config{Security: config.Security{CaptchaEnabled: false}},
				logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
				usecase: usecase,
				captcha: captcha.NewCaptcha(),
			}
			w := web.New()
			w.POST("/login", web.BindHandler(h.PasswordLogin))

			req := httptest.NewRequest(http.MethodPost, "/login", bytes.NewBufferString(tt.body))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			w.Echo().ServeHTTP(httptest.NewRecorder(), req)

			if !usecase.called {
				t.Fatal("PasswordLogin usecase was not called")
			}
		})
	}
}

func TestResetPasswordCaptchaToggle(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		wantErr error
		called  bool
	}{
		{name: "enabled", enabled: true, wantErr: errcode.ErrForbidden},
		{name: "disabled", enabled: false, wantErr: errCaptchaUsecase, called: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usecase := &passwordLoginUsecaseStub{}
			h := &AuthHandler{
				logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
				usecase: usecase,
				captcha: captcha.NewCaptcha(tt.enabled),
			}

			err := h.SendResetPasswordEmail(testWebContext(), domain.ResetUserPasswordEmailReq{Emails: []string{"user@example.com"}})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("SendResetPasswordEmail() error = %v, want %v", err, tt.wantErr)
			}
			if usecase.resetCalled != tt.called {
				t.Fatalf("SendResetPasswordEmail usecase called = %v, want %v", usecase.resetCalled, tt.called)
			}
		})
	}
}

func testWebContext() *web.Context {
	e := echo.New()
	req := httptest.NewRequest("POST", "/", nil)
	return &web.Context{Context: e.NewContext(req, httptest.NewRecorder())}
}

type passwordLoginUsecaseStub struct {
	domain.UserUsecase
	called      bool
	resetCalled bool
}

func (s *passwordLoginUsecaseStub) PasswordLogin(context.Context, *domain.TeamLoginReq) (*domain.User, error) {
	s.called = true
	return nil, errors.New("login failed")
}

var errCaptchaUsecase = errors.New("usecase called")

func (s *passwordLoginUsecaseStub) SendResetPasswordEmail(context.Context, *domain.ResetUserPasswordEmailReq) error {
	s.resetCalled = true
	return errCaptchaUsecase
}
