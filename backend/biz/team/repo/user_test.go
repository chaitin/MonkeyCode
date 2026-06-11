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
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmember"
	"github.com/chaitin/MonkeyCode/backend/db/teamimage"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
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

func TestInitTeamCreatesMemberInDefaultGroup(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if err := repo.InitTeam(ctx, "admin@example.com", "MonkeyCode", "password", ""); err != nil {
		t.Fatal(err)
	}

	admin, err := client.User.Query().
		Where(user.EmailEQ("admin@example.com"), user.RoleEQ(consts.UserRoleEnterprise)).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	memberUser, err := client.User.Query().
		Where(user.EmailEQ("admin@example.com"), user.RoleEQ(consts.UserRoleSubAccount)).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if admin.ID == memberUser.ID {
		t.Fatal("admin and member should be different users")
	}
	if err := crypto.VerifyPassword(memberUser.Password, "password"); err != nil {
		t.Fatalf("verify member password failed: %v", err)
	}

	adminMember, err := client.TeamMember.Query().
		Where(teammember.UserIDEQ(admin.ID), teammember.RoleEQ(consts.TeamMemberRoleAdmin)).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	member, err := client.TeamMember.Query().
		Where(
			teammember.TeamIDEQ(adminMember.TeamID),
			teammember.UserIDEQ(memberUser.ID),
			teammember.RoleEQ(consts.TeamMemberRoleUser),
		).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	group, err := client.TeamGroup.Query().
		Where(teamgroup.TeamIDEQ(member.TeamID), teamgroup.NameEQ(defaultTeamGroupName)).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	exists, err := client.TeamGroupMember.Query().
		Where(teamgroupmember.GroupIDEQ(group.ID), teamgroupmember.UserIDEQ(memberUser.ID)).
		Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("member was not added to default group")
	}

	if err := repo.InitTeam(ctx, "admin@example.com", "MonkeyCode", "password", ""); err != nil {
		t.Fatal(err)
	}
	if count, err := client.User.Query().Where(user.EmailEQ("admin@example.com")).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 2 {
		t.Fatalf("user count = %d, want 2", count)
	}
	if count, err := client.TeamMember.Query().Where(teammember.TeamIDEQ(adminMember.TeamID)).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 2 {
		t.Fatalf("team member count = %d, want 2", count)
	}
	if count, err := client.TeamGroupMember.Query().Where(teamgroupmember.GroupIDEQ(group.ID)).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("default group member count = %d, want 1", count)
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
	memberUser, err := client.User.Query().
		Where(user.EmailEQ("admin@example.com"), user.RoleEQ(consts.UserRoleSubAccount)).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := crypto.VerifyPassword(memberUser.Password, "password"); err != nil {
		t.Fatalf("verify member password failed: %v", err)
	}
	if count, err := client.TeamMember.Query().
		Where(teammember.TeamIDEQ(teamID), teammember.UserIDEQ(memberUser.ID), teammember.RoleEQ(consts.TeamMemberRoleUser)).
		Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("team member count = %d, want 1", count)
	}
	group, err := client.TeamGroup.Query().
		Where(teamgroup.TeamIDEQ(teamID), teamgroup.NameEQ(defaultTeamGroupName)).
		First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count, err := client.TeamGroupMember.Query().
		Where(teamgroupmember.GroupIDEQ(group.ID), teamgroupmember.UserIDEQ(memberUser.ID)).
		Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("default group member count = %d, want 1", count)
	}
}

func TestResetPasswordStoresHashedPassword(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	userID := uuid.New()
	oldPassword, err := crypto.HashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.User.Create().
		SetID(userID).
		SetName("member").
		SetEmail("member@example.com").
		SetPassword(oldPassword).
		SetRole(consts.UserRoleSubAccount).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatal(err)
	}

	if err := repo.ResetPassword(ctx, userID, "NewPassword123456"); err != nil {
		t.Fatal(err)
	}

	updated, err := client.User.Get(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Password == "" || updated.Password == "NewPassword123456" {
		t.Fatalf("password should be hashed, got %q", updated.Password)
	}
	if err := crypto.VerifyPassword(updated.Password, "NewPassword123456"); err != nil {
		t.Fatalf("verify new password failed: %v", err)
	}
	if err := crypto.VerifyPassword(updated.Password, "old-password"); err == nil {
		t.Fatal("old password should not remain valid")
	}
}

func TestMemberListSkipsDeletedUsers(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	teamID := createTeamRepoTestTeam(t, client)
	activeUserID := createTeamRepoNamedUser(t, client, "active@example.com")
	deletedUserID := createTeamRepoNamedUser(t, client, "deleted@example.com")
	createTeamRepoTestMember(t, client, teamID, activeUserID, consts.TeamMemberRoleUser)
	createTeamRepoTestMember(t, client, teamID, deletedUserID, consts.TeamMemberRoleUser)
	if err := client.User.DeleteOneID(deletedUserID).Exec(ctx); err != nil {
		t.Fatal(err)
	}

	members, err := repo.MemberList(ctx, teamID, consts.TeamMemberRoleUser)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 {
		t.Fatalf("len(members) = %d, want 1", len(members))
	}
	if members[0].UserID != activeUserID {
		t.Fatalf("member user id = %s, want %s", members[0].UserID, activeUserID)
	}
}

func TestDeleteUserSoftDeletesUserAndKeepsTeamMember(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoNamedUser(t, client, "member@example.com")
	createTeamRepoTestMember(t, client, teamID, userID, consts.TeamMemberRoleUser)

	if err := repo.DeleteUser(ctx, teamID, userID); err != nil {
		t.Fatal(err)
	}
	deleted, err := client.User.Query().
		Where(user.IDEQ(userID)).
		Only(entx.SkipSoftDelete(ctx))
	if err != nil {
		t.Fatal(err)
	}
	if deleted.DeletedAt.IsZero() {
		t.Fatal("deleted_at was not set")
	}
	exists, err := client.TeamMember.Query().
		Where(teammember.TeamIDEQ(teamID), teammember.UserIDEQ(userID)).
		Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("team member relation should be kept")
	}
}

func TestEnsureDefaultTeamGroupReturnsExistingGroup(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	repo := &TeamGroupUserRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	teamID := createTeamRepoTestTeam(t, client)
	existing, err := client.TeamGroup.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetName(defaultTeamGroupName).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	var group *db.TeamGroup
	if err := entx.WithTx2(ctx, client, func(tx *db.Tx) error {
		var err error
		group, err = repo.ensureDefaultTeamGroup(ctx, tx, teamID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if group.ID != existing.ID {
		t.Fatalf("group id = %s, want %s", group.ID, existing.ID)
	}
	if count, err := client.TeamGroup.Query().
		Where(teamgroup.TeamIDEQ(teamID), teamgroup.NameEQ(defaultTeamGroupName)).
		Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("default group count = %d, want 1", count)
	}
}

func createTeamRepoTestTeam(t *testing.T, client *db.Client) uuid.UUID {
	t.Helper()
	team, err := client.Team.Create().
		SetID(uuid.New()).
		SetName("team").
		SetMemberLimit(5).
		Save(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return team.ID
}

func createTeamRepoNamedUser(t *testing.T, client *db.Client, email string) uuid.UUID {
	t.Helper()
	usr, err := client.User.Create().
		SetID(uuid.New()).
		SetName(email).
		SetEmail(email).
		SetPassword("").
		SetRole(consts.UserRoleSubAccount).
		SetStatus(consts.UserStatusActive).
		Save(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return usr.ID
}

func createTeamRepoTestMember(t *testing.T, client *db.Client, teamID, userID uuid.UUID, role consts.TeamMemberRole) {
	t.Helper()
	if _, err := client.TeamMember.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetUserID(userID).
		SetRole(role).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
}
