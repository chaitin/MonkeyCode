package repo

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/db/useridentity"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestCreateIndividualWithIdentityCreatesUserAndIdentity(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_oauth_create?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	usr, err := repo.CreateIndividualWithIdentity(ctx, &domain.OAuthLoginUser{
		Provider:   consts.UserPlatformGoogle,
		IdentityID: "google-sub-1",
		Email:      "alice@example.com",
		Name:       "Alice",
		AvatarURL:  "https://example.com/avatar.png",
	})
	if err != nil {
		t.Fatal(err)
	}
	if usr.Role != consts.UserRoleIndividual {
		t.Fatalf("role = %s, want %s", usr.Role, consts.UserRoleIndividual)
	}
	if usr.Email != "alice@example.com" {
		t.Fatalf("email = %q", usr.Email)
	}
	count, err := client.UserIdentity.Query().Where(
		useridentity.PlatformEQ(consts.UserPlatformGoogle),
		useridentity.IdentityIDEQ("google-sub-1"),
	).Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("identity count = %d, want 1", count)
	}
}

func TestFindUserByOAuthIdentityReturnsBoundUser(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_oauth_find?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	userID := uuid.New()
	if _, err := client.User.Create().SetID(userID).SetName("Alice").SetEmail("alice@example.com").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserIdentity.Create().SetID(uuid.New()).SetUserID(userID).SetPlatform(consts.UserPlatformGoogle).SetIdentityID("google-sub-1").SetUsername("Alice").Save(ctx); err != nil {
		t.Fatal(err)
	}

	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	usr, err := repo.FindUserByOAuthIdentity(ctx, consts.UserPlatformGoogle, "google-sub-1")
	if err != nil {
		t.Fatal(err)
	}
	if usr.ID != userID {
		t.Fatalf("user id = %s, want %s", usr.ID, userID)
	}
}

func TestBindOAuthIdentityIsIdempotent(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_oauth_bind?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	userID := uuid.New()
	if _, err := client.User.Create().SetID(userID).SetName("Alice").SetEmail("alice@example.com").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	external := &domain.OAuthLoginUser{
		Provider:   consts.UserPlatformGoogle,
		IdentityID: "google-sub-1",
		Email:      "alice@example.com",
		Name:       "Alice",
	}
	if err := repo.BindOAuthIdentity(ctx, userID, external); err != nil {
		t.Fatal(err)
	}
	if err := repo.BindOAuthIdentity(ctx, userID, external); err != nil {
		t.Fatal(err)
	}
	count, err := client.UserIdentity.Query().Where(
		useridentity.PlatformEQ(consts.UserPlatformGoogle),
		useridentity.IdentityIDEQ("google-sub-1"),
	).Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("identity count = %d, want 1", count)
	}
}

func TestBindOAuthIdentitySetsUserAvatarOnlyWhenEmpty(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_oauth_bind_avatar?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	emptyAvatarUserID := uuid.New()
	if _, err := client.User.Create().SetID(emptyAvatarUserID).SetName("Alice").SetEmail("alice@example.com").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	customAvatarUserID := uuid.New()
	if _, err := client.User.Create().SetID(customAvatarUserID).SetName("Bob").SetEmail("bob@example.com").SetAvatarURL("https://oss.example.com/custom.png").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if err := repo.BindOAuthIdentity(ctx, emptyAvatarUserID, &domain.OAuthLoginUser{
		Provider:   consts.UserPlatformGoogle,
		IdentityID: "google-sub-1",
		Email:      "alice@example.com",
		Name:       "Alice",
		AvatarURL:  "https://oss.example.com/oauth-avatar.png",
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.BindOAuthIdentity(ctx, customAvatarUserID, &domain.OAuthLoginUser{
		Provider:   consts.UserPlatformGithub,
		IdentityID: "12345",
		Email:      "bob@example.com",
		Name:       "Bob",
		AvatarURL:  "https://oss.example.com/github-avatar.png",
	}); err != nil {
		t.Fatal(err)
	}

	emptyAvatarUser, err := client.User.Get(ctx, emptyAvatarUserID)
	if err != nil {
		t.Fatal(err)
	}
	if emptyAvatarUser.AvatarURL != "https://oss.example.com/oauth-avatar.png" {
		t.Fatalf("empty avatar user avatar = %q", emptyAvatarUser.AvatarURL)
	}
	customAvatarUser, err := client.User.Get(ctx, customAvatarUserID)
	if err != nil {
		t.Fatal(err)
	}
	if customAvatarUser.AvatarURL != "https://oss.example.com/custom.png" {
		t.Fatalf("custom avatar user avatar = %q", customAvatarUser.AvatarURL)
	}
}

func TestUpdateOAuthIdentityRefreshesIdentityAvatarOnly(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_oauth_update_identity_avatar?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	userID := uuid.New()
	if _, err := client.User.Create().SetID(userID).SetName("Alice").SetEmail("alice@example.com").SetAvatarURL("https://oss.example.com/custom.png").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserIdentity.Create().SetID(uuid.New()).SetUserID(userID).SetPlatform(consts.UserPlatformGoogle).SetIdentityID("google-sub-1").SetUsername("Alice").SetAvatarURL("https://oss.example.com/old.png").Save(ctx); err != nil {
		t.Fatal(err)
	}
	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}

	if err := repo.UpdateOAuthIdentity(ctx, &domain.OAuthLoginUser{
		Provider:   consts.UserPlatformGoogle,
		IdentityID: "google-sub-1",
		Email:      "alice@example.com",
		Name:       "Alice New",
		AvatarURL:  "https://oss.example.com/new.png",
	}); err != nil {
		t.Fatal(err)
	}

	identity, err := client.UserIdentity.Query().Where(useridentity.PlatformEQ(consts.UserPlatformGoogle), useridentity.IdentityIDEQ("google-sub-1")).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if identity.AvatarURL != "https://oss.example.com/new.png" {
		t.Fatalf("identity avatar = %q", identity.AvatarURL)
	}
	usr, err := client.User.Query().Where(user.IDEQ(userID)).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if usr.AvatarURL != "https://oss.example.com/custom.png" {
		t.Fatalf("user avatar = %q", usr.AvatarURL)
	}
}

func TestUpdateOAuthIdentityRefreshesUserAvatarWhenStillUsingIdentityAvatar(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_oauth_update_user_avatar?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	userID := uuid.New()
	oldAvatar := "https://oss.example.com/old.png"
	newAvatar := "https://oss.example.com/new.png"
	if _, err := client.User.Create().SetID(userID).SetName("Alice").SetEmail("alice@example.com").SetAvatarURL(oldAvatar).SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserIdentity.Create().SetID(uuid.New()).SetUserID(userID).SetPlatform(consts.UserPlatformGoogle).SetIdentityID("google-sub-1").SetUsername("Alice").SetAvatarURL(oldAvatar).Save(ctx); err != nil {
		t.Fatal(err)
	}
	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}

	if err := repo.UpdateOAuthIdentity(ctx, &domain.OAuthLoginUser{
		Provider:   consts.UserPlatformGoogle,
		IdentityID: "google-sub-1",
		Email:      "alice@example.com",
		Name:       "Alice",
		AvatarURL:  newAvatar,
	}); err != nil {
		t.Fatal(err)
	}

	usr, err := client.User.Get(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if usr.AvatarURL != newAvatar {
		t.Fatalf("user avatar = %q, want %q", usr.AvatarURL, newAvatar)
	}
}

func TestFindIndividualByEmailIgnoresSubAccount(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user_repo_oauth_role?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	if _, err := client.User.Create().SetID(uuid.New()).SetName("Member").SetEmail("alice@example.com").SetRole(consts.UserRoleSubAccount).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	repo := &userRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	usr, err := repo.FindIndividualByEmail(ctx, "alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if usr != nil {
		t.Fatalf("expected nil user, got %s", usr.ID)
	}
}
