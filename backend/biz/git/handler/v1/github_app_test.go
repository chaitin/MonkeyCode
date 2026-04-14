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
	gh "github.com/google/go-github/v74/github"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func TestGithubAppSetup_RedirectsOnSuccess(t *testing.T) {
	user := &domain.User{ID: uuid.New()}
	ghClient := &stubGithubAppClient{
		installation: &gh.Installation{
			ID: gh.Ptr(int64(1001)),
			Account: &gh.User{
				Login: gh.Ptr("octocat"),
			},
		},
	}
	identityUsecase := &stubGitIdentityUsecase{}
	h := newTestGithubAppHandler(ghClient, identityUsecase)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/github/app/setup?installation_id=1001&setup_action=install", nil)
	rec := httptest.NewRecorder()

	err := h.GithubAppSetup(newTestWebContext(req, rec, user), domain.GithubAppSetupReq{
		InstallationID: 1001,
		SetupAction:    "install",
	})
	if err != nil {
		t.Fatalf("GithubAppSetup returned error: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", rec.Code)
	}
	location := rec.Header().Get("Location")
	if !strings.Contains(location, "github_setup=success") {
		t.Fatalf("expected success redirect, got %q", location)
	}
	if !strings.Contains(location, "installation_id=1001") {
		t.Fatalf("expected installation id in redirect, got %q", location)
	}
	if !strings.Contains(location, "account_login=octocat") {
		t.Fatalf("expected account_login in redirect, got %q", location)
	}
	if ghClient.lastInstallationID != 1001 {
		t.Fatalf("expected installation lookup for 1001, got %d", ghClient.lastInstallationID)
	}
	if identityUsecase.lastUID != user.ID {
		t.Fatalf("expected upsert for user %s, got %s", user.ID, identityUsecase.lastUID)
	}
	if identityUsecase.lastReq == nil {
		t.Fatal("expected git identity upsert request")
	}
	if identityUsecase.lastReq.Platform != consts.GitPlatformGithub {
		t.Fatalf("expected github platform, got %s", identityUsecase.lastReq.Platform)
	}
	if identityUsecase.lastReq.AccountLogin != "octocat" {
		t.Fatalf("expected account login octocat, got %q", identityUsecase.lastReq.AccountLogin)
	}
}

func TestGithubAppSetup_RedirectsOnInvalidSetupAction(t *testing.T) {
	user := &domain.User{ID: uuid.New()}
	h := newTestGithubAppHandler(&stubGithubAppClient{}, &stubGitIdentityUsecase{})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/github/app/setup?installation_id=1001", nil)
	rec := httptest.NewRecorder()

	err := h.GithubAppSetup(newTestWebContext(req, rec, user), domain.GithubAppSetupReq{
		InstallationID: 1001,
	})
	if err != nil {
		t.Fatalf("GithubAppSetup returned error: %v", err)
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", rec.Code)
	}
	location := rec.Header().Get("Location")
	if !strings.Contains(location, "github_setup=error") {
		t.Fatalf("expected error redirect, got %q", location)
	}
	if !strings.Contains(location, "reason=not_owner") {
		t.Fatalf("expected not_owner reason, got %q", location)
	}
}

func TestGithubAppCallback_IssueCommentCreatesGitTask(t *testing.T) {
	ghClient := &stubGithubAppClient{
		installationToken: "installation-token",
		pullRequest: &gh.PullRequest{
			ID:      gh.Ptr(int64(2001)),
			Number:  gh.Ptr(10),
			Title:   gh.Ptr("Fix bug"),
			HTMLURL: gh.Ptr("https://github.com/octo/repo/pull/10"),
			Head: &gh.PullRequestBranch{
				Ref: gh.Ptr("feature/test"),
				Repo: &gh.Repository{
					ID:          gh.Ptr(int64(3001)),
					Name:        gh.Ptr("repo"),
					FullName:    gh.Ptr("octo/repo"),
					HTMLURL:     gh.Ptr("https://github.com/octo/repo"),
					Description: gh.Ptr("repo desc"),
					Private:     gh.Ptr(true),
				},
			},
		},
	}
	taskUsecase := &stubGitTaskUsecase{}
	h := newTestGithubAppHandler(ghClient, &stubGitIdentityUsecase{})
	h.gitTaskUsecase = taskUsecase

	payload := []byte(`{
		"action":"created",
		"comment":{
			"id":12345,
			"body":"@monkeycode please handle this",
			"html_url":"https://github.com/octo/repo/pull/10#issuecomment-12345",
			"user":{
				"login":"alice",
				"type":"User",
				"avatar_url":"https://avatars.example/alice.png",
				"email":"alice@example.com"
			}
		},
		"issue":{
			"number":10,
			"pull_request":{
				"url":"https://api.github.com/repos/octo/repo/pulls/10"
			}
		},
		"installation":{"id":1001}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/github/app/callback", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Github-Event", "issue_comment")
	signGithubAppPayload(t, req, "test-secret", payload)
	rec := httptest.NewRecorder()

	err := h.Callback(newTestWebContext(req, rec, nil))
	if err != nil {
		t.Fatalf("Callback returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if taskUsecase.lastReq == nil {
		t.Fatal("expected git task request to be created")
	}
	if taskUsecase.lastReq.GithubInstallationID != 1001 {
		t.Fatalf("expected github installation id 1001, got %d", taskUsecase.lastReq.GithubInstallationID)
	}
	if taskUsecase.lastReq.Git.Token != "installation-token" {
		t.Fatalf("expected git token installation-token, got %q", taskUsecase.lastReq.Git.Token)
	}
	if taskUsecase.lastReq.Env["GITHUB_TOKEN"] != "installation-token" {
		t.Fatalf("expected env GITHUB_TOKEN to be injected, got %q", taskUsecase.lastReq.Env["GITHUB_TOKEN"])
	}
	if taskUsecase.lastReq.HostID != "host-1" {
		t.Fatalf("expected default host id host-1, got %q", taskUsecase.lastReq.HostID)
	}
	if ghClient.lastTokenInstallationID != 1001 {
		t.Fatalf("expected installation token lookup for 1001, got %d", ghClient.lastTokenInstallationID)
	}
	if ghClient.lastPullRequestURL != "https://api.github.com/repos/octo/repo/pulls/10" {
		t.Fatalf("expected pull request api url to be used, got %q", ghClient.lastPullRequestURL)
	}
}

func TestGithubAppCallback_IgnoresPlainIssueComment(t *testing.T) {
	ghClient := &stubGithubAppClient{}
	taskUsecase := &stubGitTaskUsecase{}
	h := newTestGithubAppHandler(ghClient, &stubGitIdentityUsecase{})
	h.gitTaskUsecase = taskUsecase

	payload := []byte(`{
		"action":"created",
		"comment":{
			"id":12346,
			"body":"@monkeycode please handle this",
			"user":{"login":"alice","type":"User"}
		},
		"issue":{"number":10},
		"installation":{"id":1001}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/github/app/callback", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Github-Event", "issue_comment")
	signGithubAppPayload(t, req, "test-secret", payload)
	rec := httptest.NewRecorder()

	if err := h.Callback(newTestWebContext(req, rec, nil)); err != nil {
		t.Fatalf("Callback returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if taskUsecase.lastReq != nil {
		t.Fatal("expected plain issue comment to be ignored")
	}
}

func TestGithubAppCallback_IgnoresCommentWithoutAtKeyword(t *testing.T) {
	ghClient := &stubGithubAppClient{}
	taskUsecase := &stubGitTaskUsecase{}
	h := newTestGithubAppHandler(ghClient, &stubGitIdentityUsecase{})
	h.gitTaskUsecase = taskUsecase

	payload := []byte(`{
		"action":"created",
		"comment":{
			"id":12347,
			"body":"please handle this",
			"user":{"login":"alice","type":"User"}
		},
		"issue":{
			"number":10,
			"pull_request":{"url":"https://api.github.com/repos/octo/repo/pulls/10"}
		},
		"installation":{"id":1001}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/github/app/callback", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Github-Event", "issue_comment")
	signGithubAppPayload(t, req, "test-secret", payload)
	rec := httptest.NewRecorder()

	if err := h.Callback(newTestWebContext(req, rec, nil)); err != nil {
		t.Fatalf("Callback returned error: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if taskUsecase.lastReq != nil {
		t.Fatal("expected comment without at keyword to be ignored")
	}
}

func TestGithubAppCallback_Returns500WhenInstallationTokenFails(t *testing.T) {
	ghClient := &stubGithubAppClient{
		tokenErr: errors.New("boom"),
	}
	h := newTestGithubAppHandler(ghClient, &stubGitIdentityUsecase{})

	payload := []byte(`{
		"action":"created",
		"comment":{"id":12348,"body":"@monkeycode please handle this","user":{"login":"alice","type":"User"}},
		"issue":{"number":10,"pull_request":{"url":"https://api.github.com/repos/octo/repo/pulls/10"}},
		"installation":{"id":1001}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/github/app/callback", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Github-Event", "issue_comment")
	signGithubAppPayload(t, req, "test-secret", payload)
	rec := httptest.NewRecorder()

	if err := h.Callback(newTestWebContext(req, rec, nil)); err != nil {
		t.Fatalf("Callback returned error: %v", err)
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}
}

func newTestGithubAppHandler(ghClient *stubGithubAppClient, gitIdentityUsecase *stubGitIdentityUsecase) *GithubAppHandler {
	cfg := &config.Config{}
	cfg.Github.App.RedirectURL = "http://frontend.example/settings"
	cfg.Github.App.WebhookSecret = "test-secret"
	cfg.Task.AtKeyword = "@monkeycode"
	cfg.Task.HostIDs = []string{"host-1"}
	cfg.Task.ImageID = "11111111-1111-1111-1111-111111111111"

	return &GithubAppHandler{
		cfg:            cfg,
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		gh:             ghClient,
		gitIdentityUse: gitIdentityUsecase,
		gitTaskUsecase: &stubGitTaskUsecase{},
	}
}

func newTestWebContext(req *http.Request, rec *httptest.ResponseRecorder, user *domain.User) *web.Context {
	e := echo.New()
	e.Validator = web.NewCustomValidator()
	ctx := &web.Context{Context: e.NewContext(req, rec)}
	if user != nil {
		middleware.SetUser(ctx, user)
	}
	return ctx
}

type stubGithubAppClient struct {
	installation            *gh.Installation
	pullRequest             *gh.PullRequest
	installationToken       string
	tokenErr                error
	lastInstallationID      int64
	lastTokenInstallationID int64
	lastPullRequestURL      string
}

func (s *stubGithubAppClient) GetInstallation(_ context.Context, installationID int64) (*gh.Installation, error) {
	s.lastInstallationID = installationID
	return s.installation, nil
}

func (s *stubGithubAppClient) GetInstallationToken(_ context.Context, installationID int64) (string, error) {
	s.lastTokenInstallationID = installationID
	if s.tokenErr != nil {
		return "", s.tokenErr
	}
	return s.installationToken, nil
}

func (s *stubGithubAppClient) GetPullRequest(_ context.Context, _ string, pullRequestURL string) (*gh.PullRequest, error) {
	s.lastPullRequestURL = pullRequestURL
	return s.pullRequest, nil
}

type stubGitIdentityUsecase struct {
	lastUID uuid.UUID
	lastReq *domain.UpsertGitIdentityByInstallationReq
}

func (s *stubGitIdentityUsecase) List(context.Context, uuid.UUID) ([]*domain.GitIdentity, error) {
	panic("not implemented")
}

func (s *stubGitIdentityUsecase) Get(context.Context, uuid.UUID, uuid.UUID) (*domain.GitIdentity, error) {
	panic("not implemented")
}

func (s *stubGitIdentityUsecase) Add(context.Context, uuid.UUID, *domain.AddGitIdentityReq) (*domain.GitIdentity, error) {
	panic("not implemented")
}

func (s *stubGitIdentityUsecase) Update(context.Context, uuid.UUID, *domain.UpdateGitIdentityReq) error {
	panic("not implemented")
}

func (s *stubGitIdentityUsecase) Delete(context.Context, uuid.UUID, uuid.UUID) error {
	panic("not implemented")
}

func (s *stubGitIdentityUsecase) UpsertByInstallationID(_ context.Context, uid uuid.UUID, req *domain.UpsertGitIdentityByInstallationReq) (*domain.GitIdentity, error) {
	s.lastUID = uid
	s.lastReq = req
	return &domain.GitIdentity{ID: uuid.New()}, nil
}

func (s *stubGitIdentityUsecase) ListBranches(context.Context, uuid.UUID, uuid.UUID, string, int, int) ([]*domain.Branch, error) {
	panic("not implemented")
}

type stubGitTaskUsecase struct {
	lastReq *domain.CreateGitTaskReq
}

func (s *stubGitTaskUsecase) Create(_ context.Context, req domain.CreateGitTaskReq) (*domain.GitTask, error) {
	s.lastReq = &req
	return nil, nil
}

func signGithubAppPayload(t *testing.T, req *http.Request, secret string, payload []byte) {
	t.Helper()

	mac := hmac.New(sha256.New, []byte(secret))
	if _, err := mac.Write(payload); err != nil {
		t.Fatalf("sign payload failed: %v", err)
	}
	req.Header.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
}

var _ domain.GitIdentityUsecase = (*stubGitIdentityUsecase)(nil)
var _ domain.GitTaskUsecase = (*stubGitTaskUsecase)(nil)
