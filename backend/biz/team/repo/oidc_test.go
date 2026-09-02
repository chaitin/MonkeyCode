package repo

import (
	"context"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/oidc"
)

func TestTeamOIDCConfigSchemaPersistsDefaults(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:team_oidc_config?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	teamID := uuid.New()
	_, err := client.Team.Create().
		SetID(teamID).
		SetName("研发团队").
		SetMemberLimit(10).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	cfg, err := client.TeamOIDCConfig.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetEnabled(true).
		SetDisplayName("公司账号登录").
		SetIssuer("https://id.example.com").
		SetClientID("monkeycode").
		SetClientSecretCiphertext("secret").
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Scopes != "openid email profile" {
		t.Fatalf("scopes = %q, want default openid email profile", cfg.Scopes)
	}
	if cfg.AutoCreateMember {
		t.Fatal("auto_create_member default should be false")
	}
	if !cfg.AllowPasswordLogin {
		t.Fatal("allow_password_login default should be true")
	}
}

func TestTeamOIDCRepoFindsOnlyOrdinaryTeamMember(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:team_oidc_member_role?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	teamID := uuid.New()
	if _, err := client.Team.Create().
		SetID(teamID).
		SetName("研发团队").
		SetMemberLimit(10).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	adminOnlyTeamID := uuid.New()
	if _, err := client.Team.Create().
		SetID(adminOnlyTeamID).
		SetName("仅管理员团队").
		SetMemberLimit(10).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	admin, err := client.User.Create().
		SetID(uuid.New()).
		SetName("Admin").
		SetEmail("same@example.com").
		SetRole(consts.UserRoleEnterprise).
		SetStatus(consts.UserStatusActive).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	member, err := client.User.Create().
		SetID(uuid.New()).
		SetName("Member").
		SetEmail("same@example.com").
		SetRole(consts.UserRoleSubAccount).
		SetStatus(consts.UserStatusActive).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamMember.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetUserID(admin.ID).
		SetRole(consts.TeamMemberRoleAdmin).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamMember.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetUserID(member.ID).
		SetRole(consts.TeamMemberRoleUser).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamMember.Create().
		SetID(uuid.New()).
		SetTeamID(adminOnlyTeamID).
		SetUserID(admin.ID).
		SetRole(consts.TeamMemberRoleAdmin).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserIdentity.Create().
		SetID(uuid.New()).
		SetUserID(admin.ID).
		SetPlatform(consts.UserPlatformOIDC).
		SetIdentityID("admin-identity").
		SetUsername("Admin").
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserIdentity.Create().
		SetID(uuid.New()).
		SetUserID(member.ID).
		SetPlatform(consts.UserPlatformOIDC).
		SetIdentityID("member-identity").
		SetUsername("Member").
		Save(ctx); err != nil {
		t.Fatal(err)
	}

	repo := &TeamOIDCRepo{db: client}
	teamMember, err := repo.FindTeamMemberByEmail(ctx, teamID, "same@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if teamMember.Edges.User == nil || teamMember.Edges.User.ID != member.ID {
		t.Fatalf("matched user = %+v, want member %s", teamMember.Edges.User, member.ID)
	}
	if _, err := repo.FindTeamMemberByEmail(ctx, adminOnlyTeamID, "same@example.com"); !db.IsNotFound(err) {
		t.Fatalf("admin-only email lookup err = %v, want not found so auto-create can run", err)
	}
	if _, err := repo.FindUserByOIDCIdentity(ctx, teamID, "admin-identity"); !db.IsNotFound(err) {
		t.Fatalf("admin identity err = %v, want not found", err)
	}
	found, err := repo.FindUserByOIDCIdentity(ctx, teamID, "member-identity")
	if err != nil {
		t.Fatal(err)
	}
	if found.ID != member.ID {
		t.Fatalf("identity user = %s, want member %s", found.ID, member.ID)
	}
}

func TestTeamOIDCRepoBindOIDCIdentitySkipsCreateWhenIdentityExists(t *testing.T) {
	ctx := context.Background()
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	client := db.NewClient(db.Driver(entsql.OpenDB(dialect.Postgres, sqlDB)))
	defer client.Close()

	external := &domain.OIDCExternalUser{
		Issuer:    "https://id.example.com",
		Subject:   "sub-1",
		Email:     "new@example.com",
		Name:      "新成员",
		AvatarURL: "https://id.example.com/avatar.png",
	}
	identityID := oidc.IdentityID(external.Issuer, external.Subject)
	userID := uuid.New()

	mock.ExpectQuery(`SELECT .* FROM "user_identities"`).
		WithArgs(consts.UserPlatformOIDC, identityID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(uuid.New()))

	r := &TeamOIDCRepo{db: client}
	if err := r.BindOIDCIdentity(ctx, userID, external); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTeamOIDCRepoBindOIDCIdentityCreatesAfterExplicitLookup(t *testing.T) {
	ctx := context.Background()
	sqlDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	client := db.NewClient(db.Driver(entsql.OpenDB(dialect.Postgres, sqlDB)))
	defer client.Close()

	external := &domain.OIDCExternalUser{
		Issuer:    "https://id.example.com",
		Subject:   "sub-1",
		Email:     "new@example.com",
		Name:      "新成员",
		AvatarURL: "https://id.example.com/avatar.png",
	}
	identityID := oidc.IdentityID(external.Issuer, external.Subject)
	userID := uuid.New()

	mock.ExpectQuery(`SELECT .* FROM "user_identities"`).
		WithArgs(consts.UserPlatformOIDC, identityID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(`INSERT INTO "user_identities" .* VALUES`).
		WithArgs(consts.UserPlatformOIDC, identityID, external.Name, external.Email, external.AvatarURL, sqlmock.AnyArg(), userID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	r := &TeamOIDCRepo{db: client}
	if err := r.BindOIDCIdentity(ctx, userID, external); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTeamOIDCRepoGetDefaultEnabledConfigReturnsEarliestTeam(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:team_oidc_default?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	r := &TeamOIDCRepo{db: client}
	early := time.Date(2026, 6, 9, 10, 0, 0, 0, time.UTC)
	late := time.Date(2026, 6, 10, 10, 0, 0, 0, time.UTC)

	disabledTeamID := uuid.New()
	enabledLateTeamID := uuid.New()
	enabledEarlyTeamID := uuid.New()
	for _, tc := range []struct {
		id        uuid.UUID
		name      string
		createdAt time.Time
	}{
		{disabledTeamID, "未启用团队", early.Add(-time.Hour)},
		{enabledLateTeamID, "后创建团队", late},
		{enabledEarlyTeamID, "先创建团队", early},
	} {
		_, err := client.Team.Create().
			SetID(tc.id).
			SetName(tc.name).
			SetMemberLimit(10).
			SetCreatedAt(tc.createdAt).
			Save(ctx)
		if err != nil {
			t.Fatal(err)
		}
	}

	for _, tc := range []struct {
		teamID      uuid.UUID
		enabled     bool
		displayName string
	}{
		{disabledTeamID, false, "未启用企业登录"},
		{enabledLateTeamID, true, "后创建企业登录"},
		{enabledEarlyTeamID, true, "默认企业登录"},
	} {
		_, err := client.TeamOIDCConfig.Create().
			SetID(uuid.New()).
			SetTeamID(tc.teamID).
			SetEnabled(tc.enabled).
			SetDisplayName(tc.displayName).
			SetIssuer("https://id.example.com/").
			SetClientID("monkeycode").
			Save(ctx)
		if err != nil {
			t.Fatal(err)
		}
	}

	cfg, err := r.GetDefaultEnabledConfig(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TeamID != enabledEarlyTeamID {
		t.Fatalf("team id = %s, want %s", cfg.TeamID, enabledEarlyTeamID)
	}
	if cfg.DisplayName != "默认企业登录" {
		t.Fatalf("display name = %q", cfg.DisplayName)
	}
}
