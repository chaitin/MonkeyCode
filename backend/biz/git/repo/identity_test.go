package repo

import (
	"context"
	"log/slog"
	"testing"

	"entgo.io/ent/dialect"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/gitidentity"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestUpsertByInstallationID_UpdateByUsername(t *testing.T) {
	ctx := context.Background()
	repo := newTestGitIdentityRepo(t)
	uid := uuid.New()
	createTestUser(t, repo, uid)

	first, err := repo.UpsertByInstallationID(ctx, uid, &domain.UpsertGitIdentityByInstallationReq{
		InstallationID: 1001,
		AccountLogin:   "octocat",
		Platform:       consts.GitPlatformGithub,
	})
	if err != nil {
		t.Fatalf("first upsert failed: %v", err)
	}
	if first.InstallationID != 1001 {
		t.Fatalf("expected installation id 1001, got %d", first.InstallationID)
	}
	if first.Username != "octocat" {
		t.Fatalf("expected username octocat, got %q", first.Username)
	}
	if first.BaseURL != "https://github.com" {
		t.Fatalf("expected base url https://github.com, got %q", first.BaseURL)
	}
	if first.Email != "monkeycode-ai@chaitin.com" {
		t.Fatalf("expected default email monkeycode-ai@chaitin.com, got %q", first.Email)
	}

	second, err := repo.UpsertByInstallationID(ctx, uid, &domain.UpsertGitIdentityByInstallationReq{
		InstallationID: 2002,
		AccountLogin:   "octocat",
		Platform:       consts.GitPlatformGithub,
	})
	if err != nil {
		t.Fatalf("second upsert failed: %v", err)
	}

	if second.ID != first.ID {
		t.Fatalf("expected same git identity id, got %s and %s", first.ID, second.ID)
	}
	if second.InstallationID != 2002 {
		t.Fatalf("expected installation id 2002, got %d", second.InstallationID)
	}
	if second.Username != "octocat" {
		t.Fatalf("expected username octocat, got %q", second.Username)
	}
}

func TestUpsertByInstallationID_FallbackToUserPlatform(t *testing.T) {
	ctx := context.Background()
	repo := newTestGitIdentityRepo(t)
	uid := uuid.New()
	createTestUser(t, repo, uid)

	existing, err := repo.db.GitIdentity.Create().
		SetID(uuid.New()).
		SetUserID(uid).
		SetPlatform(consts.GitPlatformGithub).
		SetUsername("legacy-name").
		SetBaseURL("https://github.com").
		SetEmail("legacy@example.com").
		Save(ctx)
	if err != nil {
		t.Fatalf("seed git identity failed: %v", err)
	}

	got, err := repo.UpsertByInstallationID(ctx, uid, &domain.UpsertGitIdentityByInstallationReq{
		InstallationID: 3003,
		AccountLogin:   "octocat",
		Platform:       consts.GitPlatformGithub,
	})
	if err != nil {
		t.Fatalf("upsert by installation id failed: %v", err)
	}

	if got.ID != existing.ID {
		t.Fatalf("expected existing git identity %s, got %s", existing.ID, got.ID)
	}
	if got.InstallationID != 3003 {
		t.Fatalf("expected installation id 3003, got %d", got.InstallationID)
	}
	if got.Username != "octocat" {
		t.Fatalf("expected username octocat, got %q", got.Username)
	}
	if got.BaseURL != "https://github.com" {
		t.Fatalf("expected base url unchanged, got %q", got.BaseURL)
	}
}

func TestUpsertByInstallationID_FallbackAmbiguousReturnsError(t *testing.T) {
	ctx := context.Background()
	repo := newTestGitIdentityRepo(t)
	uid := uuid.New()
	createTestUser(t, repo, uid)

	for _, username := range []string{"legacy-a", "legacy-b"} {
		_, err := repo.db.GitIdentity.Create().
			SetID(uuid.New()).
			SetUserID(uid).
			SetPlatform(consts.GitPlatformGithub).
			SetUsername(username).
			SetBaseURL("https://github.com").
			SetEmail("legacy@example.com").
			Save(ctx)
		if err != nil {
			t.Fatalf("seed git identity %q failed: %v", username, err)
		}
	}

	_, err := repo.UpsertByInstallationID(ctx, uid, &domain.UpsertGitIdentityByInstallationReq{
		InstallationID: 4004,
		AccountLogin:   "octocat",
		Platform:       consts.GitPlatformGithub,
	})
	if err == nil {
		t.Fatal("expected ambiguous fallback to return error")
	}

	list, err := repo.db.GitIdentity.Query().Where(gitidentity.UserID(uid)).All(ctx)
	if err != nil {
		t.Fatalf("query git identities failed: %v", err)
	}
	for _, item := range list {
		if item.InstallationID != 0 {
			t.Fatalf("expected existing records to stay unchanged, got installation id %d for %q", item.InstallationID, item.Username)
		}
	}
}

func newTestGitIdentityRepo(t *testing.T) *GitIdentityRepo {
	t.Helper()

	client := enttest.Open(t, dialect.SQLite, "file:gitidentity?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() {
		_ = client.Close()
	})

	return &GitIdentityRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(tWriter{t: t}, nil)),
	}
}

func createTestUser(t *testing.T, repo *GitIdentityRepo, uid uuid.UUID) {
	t.Helper()

	_, err := repo.db.User.Create().
		SetID(uid).
		SetName("test-user").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(context.Background())
	if err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
}

type tWriter struct {
	t *testing.T
}

func (w tWriter) Write(p []byte) (int, error) {
	w.t.Log(string(p))
	return len(p), nil
}

var _ domain.GitIdentityRepo = (*GitIdentityRepo)(nil)
