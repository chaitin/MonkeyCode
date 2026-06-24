package usecase

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"

	"github.com/chaitin/MonkeyCode/backend/biz/user/provider"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

func TestOAuthLoginStartRejectsDisabledProvider(t *testing.T) {
	uc, _ := newOAuthLoginUsecaseForTest(t, nil, nil)

	_, err := uc.StartOAuthLogin(context.Background(), "google", "/console/tasks")
	if err != errcode.ErrOAuthLoginProviderDisabled {
		t.Fatalf("error = %v, want provider disabled", err)
	}
}

func TestOAuthLoginStartRejectsInvalidRedirect(t *testing.T) {
	cfg := oauthLoginTestConfig()
	uc, _ := newOAuthLoginUsecaseForTest(t, cfg, nil)

	_, err := uc.StartOAuthLogin(context.Background(), "google", "https://evil.example.com")
	if err != errcode.ErrOAuthLoginRedirectInvalid {
		t.Fatalf("error = %v, want redirect invalid", err)
	}
}

func TestOAuthLoginCallbackCreatesIndividualAndReturnsRedirect(t *testing.T) {
	cfg := oauthLoginTestConfig()
	repo := &oauthLoginRepoStub{}
	uc, _ := newOAuthLoginUsecaseForTest(t, cfg, repo)
	uc.avatarArchiver = &oauthAvatarArchiverStub{url: "https://oss.example.com/avatar/oauth/google/google-id.png"}

	authURL, err := uc.StartOAuthLogin(context.Background(), "google", "/console/tasks")
	if err != nil {
		t.Fatal(err)
	}
	state := stateFromAuthURL(t, authURL)
	resp, err := uc.HandleOAuthCallback(context.Background(), "google", "code", state)
	if err != nil {
		t.Fatal(err)
	}
	if resp.RedirectURL != "/console/tasks" {
		t.Fatalf("redirect = %q", resp.RedirectURL)
	}
	if resp.User == nil || resp.User.Email != "alice@example.com" {
		t.Fatalf("user = %#v", resp.User)
	}
	if repo.created == nil {
		t.Fatal("expected created user")
	}
	if repo.created.AvatarURL != "https://oss.example.com/avatar/oauth/google/google-id.png" {
		t.Fatalf("created avatar = %q", repo.created.AvatarURL)
	}
}

func TestOAuthLoginCallbackRejectsProviderMismatch(t *testing.T) {
	cfg := oauthLoginTestConfig()
	uc, _ := newOAuthLoginUsecaseForTest(t, cfg, nil)

	authURL, err := uc.StartOAuthLogin(context.Background(), "google", "/console/tasks")
	if err != nil {
		t.Fatal(err)
	}
	_, err = uc.HandleOAuthCallback(context.Background(), "github", "code", stateFromAuthURL(t, authURL))
	if err != errcode.ErrOAuthLoginStateInvalid {
		t.Fatalf("error = %v, want state invalid", err)
	}
}

func TestOAuthLoginCallbackBindsExistingIndividual(t *testing.T) {
	cfg := oauthLoginTestConfig()
	existing := &db.User{ID: uuid.New(), Name: "Alice", Email: "alice@example.com", Role: consts.UserRoleIndividual, Status: consts.UserStatusActive}
	repo := &oauthLoginRepoStub{individual: existing}
	uc, _ := newOAuthLoginUsecaseForTest(t, cfg, repo)
	uc.avatarArchiver = &oauthAvatarArchiverStub{url: "https://oss.example.com/avatar/oauth/google/google-id.png"}

	authURL, err := uc.StartOAuthLogin(context.Background(), "google", "/console/tasks")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := uc.HandleOAuthCallback(context.Background(), "google", "code", stateFromAuthURL(t, authURL))
	if err != nil {
		t.Fatal(err)
	}
	if resp.User.ID != existing.ID {
		t.Fatalf("user id = %s, want %s", resp.User.ID, existing.ID)
	}
	if !repo.bound {
		t.Fatal("expected identity bind")
	}
	if repo.boundUser == nil || repo.boundUser.AvatarURL != "https://oss.example.com/avatar/oauth/google/google-id.png" {
		t.Fatalf("bound user = %#v", repo.boundUser)
	}
}

func TestOAuthLoginCallbackRefreshesBoundIdentityAvatar(t *testing.T) {
	cfg := oauthLoginTestConfig()
	existing := &db.User{ID: uuid.New(), Name: "Alice", Email: "alice@example.com", Role: consts.UserRoleIndividual, Status: consts.UserStatusActive}
	repo := &oauthLoginRepoStub{identityUser: existing}
	uc, _ := newOAuthLoginUsecaseForTest(t, cfg, repo)
	uc.avatarArchiver = &oauthAvatarArchiverStub{url: "https://oss.example.com/avatar/oauth/google/google-id-new.png"}

	authURL, err := uc.StartOAuthLogin(context.Background(), "google", "/console/tasks")
	if err != nil {
		t.Fatal(err)
	}
	resp, err := uc.HandleOAuthCallback(context.Background(), "google", "code", stateFromAuthURL(t, authURL))
	if err != nil {
		t.Fatal(err)
	}
	if resp.User.ID != existing.ID {
		t.Fatalf("user id = %s, want %s", resp.User.ID, existing.ID)
	}
	if repo.updatedIdentity == nil || repo.updatedIdentity.AvatarURL != "https://oss.example.com/avatar/oauth/google/google-id-new.png" {
		t.Fatalf("updated identity = %#v", repo.updatedIdentity)
	}
}

func TestOAuthLoginCallbackDoesNotPersistThirdPartyAvatarWhenArchiveFails(t *testing.T) {
	cfg := oauthLoginTestConfig()
	repo := &oauthLoginRepoStub{}
	uc, _ := newOAuthLoginUsecaseForTest(t, cfg, repo)
	uc.avatarArchiver = &oauthAvatarArchiverStub{err: errors.New("upload failed")}

	authURL, err := uc.StartOAuthLogin(context.Background(), "google", "/console/tasks")
	if err != nil {
		t.Fatal(err)
	}
	_, err = uc.HandleOAuthCallback(context.Background(), "google", "code", stateFromAuthURL(t, authURL))
	if err != nil {
		t.Fatal(err)
	}
	if repo.created == nil {
		t.Fatal("expected created user")
	}
	if repo.created.AvatarURL != "" {
		t.Fatalf("created avatar = %q, want empty", repo.created.AvatarURL)
	}
}

func TestOAuthLoginArchiveAvatarLogsSkippedReasons(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	uc := &OAuthLoginUsecase{logger: logger}

	got := uc.archiveAvatar(context.Background(), &provider.ExternalUser{
		Provider:   provider.Google,
		IdentityID: "google-id",
		AvatarURL:  "https://example.com/avatar.png",
	})
	if got != "" {
		t.Fatalf("avatar url = %q, want empty", got)
	}
	if !strings.Contains(buf.String(), "skip oauth avatar archive") || !strings.Contains(buf.String(), "object_storage_disabled") {
		t.Fatalf("log = %s", buf.String())
	}

	buf.Reset()
	uc.avatarArchiver = &oauthAvatarArchiverStub{}
	got = uc.archiveAvatar(context.Background(), &provider.ExternalUser{
		Provider:   provider.Github,
		IdentityID: "12345",
	})
	if got != "" {
		t.Fatalf("avatar url = %q, want empty", got)
	}
	if !strings.Contains(buf.String(), "skip oauth avatar archive") || !strings.Contains(buf.String(), "empty_avatar_url") {
		t.Fatalf("log = %s", buf.String())
	}
}

func TestOAuthLoginCallbackRejectsNonIndividualBoundUser(t *testing.T) {
	cfg := oauthLoginTestConfig()
	repo := &oauthLoginRepoStub{identityUser: &db.User{ID: uuid.New(), Role: consts.UserRoleSubAccount, Status: consts.UserStatusActive}}
	uc, _ := newOAuthLoginUsecaseForTest(t, cfg, repo)

	authURL, err := uc.StartOAuthLogin(context.Background(), "google", "/console/tasks")
	if err != nil {
		t.Fatal(err)
	}
	_, err = uc.HandleOAuthCallback(context.Background(), "google", "code", stateFromAuthURL(t, authURL))
	if err != errcode.ErrOAuthLoginRoleDenied {
		t.Fatalf("error = %v, want role denied", err)
	}
}

func newOAuthLoginUsecaseForTest(t *testing.T, cfg *config.Config, repo *oauthLoginRepoStub) (*OAuthLoginUsecase, func()) {
	t.Helper()
	if cfg == nil {
		cfg = &config.Config{}
	}
	if repo == nil {
		repo = &oauthLoginRepoStub{}
	}
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	uc := &OAuthLoginUsecase{
		repo:   repo,
		redis:  rdb,
		config: cfg,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		providers: map[provider.Name]provider.Provider{
			provider.Google: &oauthProviderStub{name: provider.Google},
			provider.Github: &oauthProviderStub{name: provider.Github},
		},
	}
	return uc, func() {
		_ = rdb.Close()
		mr.Close()
	}
}

func oauthLoginTestConfig() *config.Config {
	cfg := &config.Config{}
	cfg.OAuthLogin.Google.Enabled = true
	cfg.OAuthLogin.Google.ClientID = "google-client"
	cfg.OAuthLogin.Google.ClientSecret = "google-secret"
	cfg.OAuthLogin.Github.Enabled = true
	cfg.OAuthLogin.Github.ClientID = "github-client"
	cfg.OAuthLogin.Github.ClientSecret = "github-secret"
	return cfg
}

func stateFromAuthURL(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	state := u.Query().Get("state")
	if state == "" {
		t.Fatalf("missing state in %q", raw)
	}
	return state
}

type oauthProviderStub struct {
	name provider.Name
}

func (p *oauthProviderStub) Name() provider.Name {
	return p.name
}

func (p *oauthProviderStub) AuthCodeURL(state, nonce string) string {
	v := url.Values{}
	v.Set("state", state)
	v.Set("nonce", nonce)
	return "https://auth.example.com/authorize?" + v.Encode()
}

func (p *oauthProviderStub) Exchange(context.Context, string) (*oauth2.Token, error) {
	return &oauth2.Token{AccessToken: "token"}, nil
}

func (p *oauthProviderStub) User(context.Context, *oauth2.Token, string) (*provider.ExternalUser, error) {
	return &provider.ExternalUser{
		Provider:      p.name,
		IdentityID:    string(p.name) + "-id",
		Email:         "alice@example.com",
		EmailVerified: true,
		Username:      "alice",
		Name:          "Alice",
		AvatarURL:     "https://example.com/avatar.png",
	}, nil
}

type oauthLoginRepoStub struct {
	identityUser    *db.User
	individual      *db.User
	created         *domain.OAuthLoginUser
	boundUser       *domain.OAuthLoginUser
	updatedIdentity *domain.OAuthLoginUser
	bound           bool
}

func (r *oauthLoginRepoStub) FindUserByOAuthIdentity(context.Context, consts.UserPlatform, string) (*db.User, error) {
	if r.identityUser == nil {
		return nil, &db.NotFoundError{}
	}
	return r.identityUser, nil
}

func (r *oauthLoginRepoStub) FindIndividualByEmail(context.Context, string) (*db.User, error) {
	return r.individual, nil
}

func (r *oauthLoginRepoStub) CreateIndividualWithIdentity(_ context.Context, external *domain.OAuthLoginUser) (*db.User, error) {
	if strings.TrimSpace(external.Email) == "" {
		return nil, errors.New("email required")
	}
	r.created = external
	return &db.User{ID: uuid.New(), Name: external.Name, Email: external.Email, Role: consts.UserRoleIndividual, Status: consts.UserStatusActive}, nil
}

func (r *oauthLoginRepoStub) BindOAuthIdentity(_ context.Context, _ uuid.UUID, external *domain.OAuthLoginUser) error {
	r.bound = true
	r.boundUser = external
	return nil
}

func (r *oauthLoginRepoStub) UpdateOAuthIdentity(_ context.Context, external *domain.OAuthLoginUser) error {
	r.updatedIdentity = external
	return nil
}

type oauthAvatarArchiverStub struct {
	url string
	err error
}

func (a *oauthAvatarArchiverStub) Archive(context.Context, provider.Name, string, string) (string, error) {
	return a.url, a.err
}
