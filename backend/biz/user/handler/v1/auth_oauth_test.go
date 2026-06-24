package v1

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/GoYoko/web"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
)

func TestOAuthLoginRouteReturnsProviderURL(t *testing.T) {
	w := web.New()
	h := &AuthHandler{
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		oauthUsecase: &oauthLoginUsecaseStub{authURL: "https://auth.example.com/authorize"},
	}
	g := w.Group("/api/v1/users")
	g.GET("/oauth/:provider/login", web.BindHandler(h.OAuthLogin))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/oauth/google/login?redirect_url=/console/tasks", nil)
	rec := httptest.NewRecorder()

	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			AuthURL string `json:"auth_url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Code != 0 {
		t.Fatalf("code = %d", resp.Code)
	}
	if got := resp.Data.AuthURL; got != "https://auth.example.com/authorize" {
		t.Fatalf("auth_url = %q", got)
	}
}

func TestOAuthCallbackRouteSavesSessionAndRedirects(t *testing.T) {
	w := web.New()
	mr := miniredis.RunT(t)
	cfg := &config.Config{}
	cfg.Redis.Host = "127.0.0.1"
	port, err := strconv.Atoi(mr.Port())
	if err != nil {
		t.Fatal(err)
	}
	cfg.Redis.Port = port
	cfg.Session.ExpireDay = 30
	sess := session.New(cfg)
	userID := uuid.New()
	h := &AuthHandler{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		authMiddleware: middleware.NewAuthMiddleware(
			sess,
			nil,
			slog.New(slog.NewTextHandler(io.Discard, nil)),
		),
		oauthUsecase: &oauthLoginUsecaseStub{
			callback: &domain.OAuthLoginCallbackResp{
				User:        &domain.User{ID: userID, Name: "Alice", Email: "alice@example.com", Role: consts.UserRoleIndividual},
				RedirectURL: "/console/tasks",
			},
		},
	}
	g := w.Group("/api/v1/users")
	g.GET("/oauth/:provider/callback", web.BindHandler(h.OAuthCallback))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/oauth/google/callback?code=c&state=s", nil)
	rec := httptest.NewRecorder()

	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Location"); got != "/console/tasks" {
		t.Fatalf("Location = %q", got)
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatal("expected session cookie")
	}
}

func TestOAuthCallbackSwaggerIsHidden(t *testing.T) {
	content, err := os.ReadFile("auth.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "@Router\t\t\t/api/v1/users/oauth/{provider}/callback") ||
		strings.Contains(string(content), "@Router /api/v1/users/oauth/{provider}/callback") {
		t.Fatal("callback route must not be exposed in swagger annotations")
	}
}

type oauthLoginUsecaseStub struct {
	authURL  string
	callback *domain.OAuthLoginCallbackResp
}

func (s *oauthLoginUsecaseStub) StartOAuthLogin(context.Context, string, string) (string, error) {
	return s.authURL, nil
}

func (s *oauthLoginUsecaseStub) HandleOAuthCallback(context.Context, string, string, string) (*domain.OAuthLoginCallbackResp, error) {
	return s.callback, nil
}
