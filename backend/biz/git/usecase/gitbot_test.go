package usecase

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestGitBotUsecaseGetAccessToken_UsesDynamicTokenFromIdentity(t *testing.T) {
	identityID := uuid.New()
	botRepo := &stubGitBotRepo{
		gitIdentityID: identityID,
	}
	u := &GitBotUsecase{
		repo:          botRepo,
		tokenProvider: &stubTokenGetter{token: "dynamic-token"},
	}

	token, err := u.GetAccessToken(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("GetAccessToken returned error: %v", err)
	}
	if token != "dynamic-token" {
		t.Fatalf("expected dynamic-token, got %q", token)
	}
	if botRepo.getGitIdentityIDCalls != 1 {
		t.Fatalf("expected GetGitIdentityID to be called once, got %d", botRepo.getGitIdentityIDCalls)
	}
	if getter := u.tokenProvider.(*stubTokenGetter); getter.lastIdentityID != identityID {
		t.Fatalf("expected token getter to receive %s, got %s", identityID, getter.lastIdentityID)
	}
}

func TestGitBotUsecaseGetAccessToken_FallsBackToBotToken(t *testing.T) {
	botRepo := &stubGitBotRepo{
		bot: &db.GitBot{Token: "bot-token"},
	}
	u := &GitBotUsecase{
		repo: botRepo,
	}

	token, err := u.GetAccessToken(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("GetAccessToken returned error: %v", err)
	}
	if token != "bot-token" {
		t.Fatalf("expected bot-token, got %q", token)
	}
	if botRepo.getByIDCalls != 1 {
		t.Fatalf("expected GetByID to be called once, got %d", botRepo.getByIDCalls)
	}
}

func TestGitBotUsecaseGetAccessToken_ReturnsErrorWhenNoTokenAvailable(t *testing.T) {
	botRepo := &stubGitBotRepo{
		bot: &db.GitBot{},
	}
	u := &GitBotUsecase{
		repo: botRepo,
	}

	_, err := u.GetAccessToken(context.Background(), uuid.New())
	if err == nil {
		t.Fatal("expected GetAccessToken to return error")
	}
	if !strings.Contains(err.Error(), "no token found") {
		t.Fatalf("expected no token found error, got %v", err)
	}
}

func TestGitBotUsecaseGetAccessToken_ReturnsWrappedErrorWhenGetGitIdentityIDFails(t *testing.T) {
	expectedErr := errors.New("lookup failed")
	u := &GitBotUsecase{
		repo: &stubGitBotRepo{
			getGitIdentityIDErr: expectedErr,
		},
	}

	_, err := u.GetAccessToken(context.Background(), uuid.New())
	if err == nil {
		t.Fatal("expected GetAccessToken to return error")
	}
	if !strings.Contains(err.Error(), "get git identity id") {
		t.Fatalf("expected wrapped git identity lookup error, got %v", err)
	}
	if !strings.Contains(err.Error(), expectedErr.Error()) {
		t.Fatalf("expected wrapped original error, got %v", err)
	}
}

func TestGitBotUsecaseGetAccessToken_ReturnsBotLookupError(t *testing.T) {
	expectedErr := errors.New("bot lookup failed")
	u := &GitBotUsecase{
		repo: &stubGitBotRepo{
			getByIDErr: expectedErr,
		},
	}

	_, err := u.GetAccessToken(context.Background(), uuid.New())
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected bot lookup error %v, got %v", expectedErr, err)
	}
}

func TestGitBotUsecaseGetAccessToken_ReturnsTokenProviderError(t *testing.T) {
	expectedErr := errors.New("token provider failed")
	u := &GitBotUsecase{
		repo: &stubGitBotRepo{
			gitIdentityID: uuid.New(),
		},
		tokenProvider: &stubTokenGetter{err: expectedErr},
	}

	_, err := u.GetAccessToken(context.Background(), uuid.New())
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected token provider error %v, got %v", expectedErr, err)
	}
}

type stubGitBotRepo struct {
	gitIdentityID         uuid.UUID
	getGitIdentityIDErr   error
	bot                   *db.GitBot
	getByIDErr            error
	getGitIdentityIDCalls int
	getByIDCalls          int
}

func (s *stubGitBotRepo) GetByID(_ context.Context, _ uuid.UUID) (*db.GitBot, error) {
	s.getByIDCalls++
	if s.getByIDErr != nil {
		return nil, s.getByIDErr
	}
	return s.bot, nil
}

func (s *stubGitBotRepo) GetInstallationID(context.Context, uuid.UUID) (int64, error) {
	panic("unexpected GetInstallationID call")
}

func (s *stubGitBotRepo) GetGitIdentityID(_ context.Context, _ uuid.UUID) (uuid.UUID, error) {
	s.getGitIdentityIDCalls++
	if s.getGitIdentityIDErr != nil {
		return uuid.Nil, s.getGitIdentityIDErr
	}
	return s.gitIdentityID, nil
}

func (s *stubGitBotRepo) List(context.Context, uuid.UUID) ([]*db.GitBot, error) {
	panic("unexpected List call")
}

func (s *stubGitBotRepo) Create(context.Context, uuid.UUID, domain.CreateGitBotReq) (*db.GitBot, error) {
	panic("unexpected Create call")
}

func (s *stubGitBotRepo) Update(context.Context, uuid.UUID, domain.UpdateGitBotReq) (*db.GitBot, error) {
	panic("unexpected Update call")
}

func (s *stubGitBotRepo) Delete(context.Context, uuid.UUID, uuid.UUID) error {
	panic("unexpected Delete call")
}

func (s *stubGitBotRepo) ListTask(context.Context, uuid.UUID, domain.ListGitBotTaskReq) ([]*db.GitBotTask, *db.PageInfo, error) {
	panic("unexpected ListTask call")
}

func (s *stubGitBotRepo) ShareBot(context.Context, uuid.UUID, domain.ShareGitBotReq) error {
	panic("unexpected ShareBot call")
}

type stubTokenGetter struct {
	token          string
	err            error
	lastIdentityID uuid.UUID
}

func (s *stubTokenGetter) GetToken(_ context.Context, identityID uuid.UUID) (string, error) {
	s.lastIdentityID = identityID
	if s.err != nil {
		return "", s.err
	}
	return s.token, nil
}

var _ domain.GitBotRepo = (*stubGitBotRepo)(nil)
