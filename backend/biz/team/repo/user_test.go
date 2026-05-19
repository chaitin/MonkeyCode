package repo

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/image"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupimage"
	"github.com/chaitin/MonkeyCode/backend/db/teamimage"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
)

func newTeamRepoTestDB(t *testing.T) *db.Client {
	t.Helper()
	client := enttest.Open(t, "sqlite3", "file:team-repo-test?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestInitTeamCreatesConfiguredImage(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if err := repo.InitTeam(ctx, "admin@example.com", "MonkeyCode", "password", "ghcr.io/chaitin/monkeycode-runner/devbox:latest"); err != nil {
		t.Fatal(err)
	}

	admin, err := client.User.Query().First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	member, err := client.TeamMember.Query().
		Where(teammember.UserIDEQ(admin.ID)).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	img, err := client.Image.Query().
		Where(image.UserIDEQ(admin.ID), image.NameEQ("ghcr.io/chaitin/monkeycode-runner/devbox:latest")).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	exists, err := client.TeamImage.Query().
		Where(teamimage.TeamIDEQ(member.TeamID), teamimage.ImageIDEQ(img.ID)).
		Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("team image relation was not created")
	}
	group, err := client.TeamGroup.Query().
		Where(teamgroup.TeamIDEQ(member.TeamID), teamgroup.NameEQ("默认分组")).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	exists, err = client.TeamGroupImage.Query().
		Where(teamgroupimage.GroupIDEQ(group.ID), teamgroupimage.ImageIDEQ(img.ID)).
		Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("default group image relation was not created")
	}

	if err := repo.InitTeam(ctx, "admin@example.com", "MonkeyCode", "password", "ghcr.io/chaitin/monkeycode-runner/devbox:latest"); err != nil {
		t.Fatal(err)
	}
	if count, err := client.Image.Query().Where(image.NameEQ("ghcr.io/chaitin/monkeycode-runner/devbox:latest")).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("image count = %d, want 1", count)
	}
	if count, err := client.TeamGroup.Query().Where(teamgroup.TeamIDEQ(member.TeamID), teamgroup.NameEQ("默认分组")).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("default group count = %d, want 1", count)
	}
}

func TestInitTeamSkipsImageWhenConfigEmpty(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if err := repo.InitTeam(ctx, "admin@example.com", "MonkeyCode", "password", ""); err != nil {
		t.Fatal(err)
	}

	if count, err := client.Image.Query().Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 0 {
		t.Fatalf("image count = %d, want 0", count)
	}
}

func TestInitTeamAddsImageForExistingTeam(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	userID := uuid.New()
	teamID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("admin").
		SetEmail("admin@example.com").
		SetPassword("hashed").
		SetRole(consts.UserRoleEnterprise).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Team.Create().
		SetID(teamID).
		SetName("MonkeyCode").
		SetMemberLimit(1000).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamMember.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetUserID(userID).
		SetRole(consts.TeamMemberRoleAdmin).
		Save(ctx); err != nil {
		t.Fatal(err)
	}

	if err := repo.InitTeam(ctx, "admin@example.com", "MonkeyCode", "password", "ghcr.io/chaitin/monkeycode-runner/devbox:latest"); err != nil {
		t.Fatal(err)
	}

	if count, err := client.TeamImage.Query().Where(teamimage.TeamIDEQ(teamID)).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("team image count = %d, want 1", count)
	}
}

func TestCreateUsersWithPasswordStoresHashedPassword(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	teamID := uuid.New()
	if _, err := client.Team.Create().
		SetID(teamID).
		SetName("MonkeyCode").
		SetMemberLimit(1000).
		Save(ctx); err != nil {
		t.Fatal(err)
	}

	users, err := repo.CreateUsersWithPassword(ctx, teamID, &domain.AddTeamUserWithPasswordReq{
		Emails: []string{"member@example.com"},
		Passwords: map[string]string{
			"member@example.com": "Abcdef123456",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 1 {
		t.Fatalf("users len = %d, want 1", len(users))
	}
	if users[0].Password == "" || users[0].Password == "Abcdef123456" {
		t.Fatalf("password should be hashed, got %q", users[0].Password)
	}
	if err := crypto.VerifyPassword(users[0].Password, "Abcdef123456"); err != nil {
		t.Fatalf("verify password failed: %v", err)
	}
}
