package v1

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestGithubWebhook_UsesDynamicTokenAndInstallationID(t *testing.T) {
	botID := uuid.New()
	taskUsecase := &stubGitTaskUsecase{}
	gitbotUsecase := &stubGitBotUsecase{
		bot: &domain.GitBot{
			ID:          botID,
			Platform:    consts.GitPlatformGithub,
			Token:       "static-token",
			SecretToken: "bot-secret",
			Host:        &domain.Host{ID: "host-1"},
		},
		accessToken:    "dynamic-gh-token",
		installationID: 1001,
	}
	h := newTestGithubWebhookHandler(gitbotUsecase, taskUsecase)

	payload := []byte(`{
		"action":"opened",
		"pull_request":{
			"id":2001,
			"number":10,
			"title":"Fix bug",
			"body":"PR body",
			"state":"open",
			"html_url":"https://github.com/octo/repo/pull/10",
			"head":{
				"ref":"feature/test",
				"repo":{
					"id":3001,
					"name":"repo",
					"full_name":"octo/repo",
					"html_url":"https://github.com/octo/repo",
					"description":"repo desc",
					"private":true
				}
			},
			"user":{
				"login":"alice",
				"avatar_url":"https://avatars.example/alice.png",
				"email":"alice@example.com"
			}
		}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/github/webhook/"+botID.String(), strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", signWebhookSecret("bot-secret", payload))
	req.Header.Set("X-Github-Event", "pull_request")
	rec := httptest.NewRecorder()

	err := h.Webhook(newTestWebContextWithParam(req, rec, "id", botID.String()))
	if err != nil {
		t.Fatalf("Webhook returned error: %v", err)
	}
	if taskUsecase.lastReq == nil {
		t.Fatal("expected git task request to be created")
	}
	if taskUsecase.lastReq.Git.Token != "dynamic-gh-token" {
		t.Fatalf("expected dynamic token, got %q", taskUsecase.lastReq.Git.Token)
	}
	if taskUsecase.lastReq.Env["GITHUB_TOKEN"] != "dynamic-gh-token" {
		t.Fatalf("expected env github token dynamic-gh-token, got %q", taskUsecase.lastReq.Env["GITHUB_TOKEN"])
	}
	if taskUsecase.lastReq.GithubInstallationID != 1001 {
		t.Fatalf("expected installation id 1001, got %d", taskUsecase.lastReq.GithubInstallationID)
	}
}

func TestGithubWebhook_Returns500WhenDynamicTokenFails(t *testing.T) {
	botID := uuid.New()
	h := newTestGithubWebhookHandler(&stubGitBotUsecase{
		bot: &domain.GitBot{
			ID:          botID,
			Platform:    consts.GitPlatformGithub,
			Token:       "static-token",
			SecretToken: "bot-secret",
			Host:        &domain.Host{ID: "host-1"},
		},
		accessTokenErr: errors.New("boom"),
	}, &stubGitTaskUsecase{})

	payload := []byte(`{
		"action":"opened",
		"pull_request":{
			"id":2002,
			"number":11,
			"title":"Fix bug",
			"body":"PR body",
			"state":"open",
			"html_url":"https://github.com/octo/repo/pull/11",
			"head":{"ref":"feature/test","repo":{"id":3002,"name":"repo","full_name":"octo/repo","html_url":"https://github.com/octo/repo","description":"repo desc","private":true}},
			"user":{"login":"alice","avatar_url":"https://avatars.example/alice.png","email":"alice@example.com"}
		}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/github/webhook/"+botID.String(), strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", signWebhookSecret("bot-secret", payload))
	req.Header.Set("X-Github-Event", "pull_request")
	rec := httptest.NewRecorder()

	if err := h.Webhook(newTestWebContextWithParam(req, rec, "id", botID.String())); err != nil {
		t.Fatalf("Webhook returned error: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}

func newTestGithubWebhookHandler(gitbotUsecase *stubGitBotUsecase, taskUsecase *stubGitTaskUsecase) *GithubWebhookHandler {
	cfg := &config.Config{}
	cfg.Task.ImageID = "11111111-1111-1111-1111-111111111111"

	return &GithubWebhookHandler{
		cfg:            cfg,
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		gitbotUsecase:  gitbotUsecase,
		gitTaskUsecase: taskUsecase,
	}
}

func newTestWebContextWithParam(req *http.Request, rec *httptest.ResponseRecorder, key, value string) *web.Context {
	e := echo.New()
	e.Validator = web.NewCustomValidator()
	ctx := e.NewContext(req, rec)
	ctx.SetParamNames(key)
	ctx.SetParamValues(value)
	return &web.Context{Context: ctx}
}

type stubGitBotUsecase struct {
	bot            *domain.GitBot
	accessToken    string
	accessTokenErr error
	installationID int64
}

func (s *stubGitBotUsecase) GetByID(context.Context, uuid.UUID) (*domain.GitBot, error) {
	return s.bot, nil
}

func (s *stubGitBotUsecase) GetInstallationID(context.Context, uuid.UUID) (int64, error) {
	return s.installationID, nil
}

func (s *stubGitBotUsecase) GetAccessToken(context.Context, uuid.UUID) (string, error) {
	if s.accessTokenErr != nil {
		return "", s.accessTokenErr
	}
	return s.accessToken, nil
}

func (s *stubGitBotUsecase) List(context.Context, uuid.UUID) (*domain.ListGitBotResp, error) {
	panic("not implemented")
}

func (s *stubGitBotUsecase) Create(context.Context, uuid.UUID, domain.CreateGitBotReq) (*domain.GitBot, error) {
	panic("not implemented")
}

func (s *stubGitBotUsecase) Update(context.Context, uuid.UUID, domain.UpdateGitBotReq) (*domain.GitBot, error) {
	panic("not implemented")
}

func (s *stubGitBotUsecase) Delete(context.Context, uuid.UUID, uuid.UUID) error {
	panic("not implemented")
}

func (s *stubGitBotUsecase) ListTask(context.Context, uuid.UUID, domain.ListGitBotTaskReq) (*domain.ListGitBotTaskResp, error) {
	panic("not implemented")
}

func (s *stubGitBotUsecase) ShareBot(context.Context, uuid.UUID, domain.ShareGitBotReq) error {
	panic("not implemented")
}

func signWebhookSecret(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

var _ domain.GitBotUsecase = (*stubGitBotUsecase)(nil)
