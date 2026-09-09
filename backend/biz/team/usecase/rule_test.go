package usecase

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func newRuleTestClient(t *testing.T, name string) *db.Client {
	t.Helper()
	client := enttest.Open(t, "sqlite3", "file:"+name+"?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func testTeamUser() *domain.TeamUser {
	return &domain.TeamUser{User: &domain.User{ID: uuid.New()}}
}

func TestTeamRuleUsecaseCreateDisableAndSkipInjection(t *testing.T) {
	ctx := context.Background()
	client := newRuleTestClient(t, "team-rule-disable")
	uc := &teamRuleUsecase{db: client}
	user := testTeamUser()

	created, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{
		Name:        "alive-rule",
		Description: "desc",
		Content:     "# keep\n",
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if !created.Enabled {
		t.Fatal("new rule should default enabled")
	}

	repo := agentresource.NewRepo(client)
	active, err := repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules: %v", err)
	}
	if len(active) != 1 || active[0].Name != "alive-rule" {
		t.Fatalf("enabled injection = %+v, want alive-rule", active)
	}

	disabled, err := uc.SetEnabled(ctx, user, &domain.SetTeamRuleEnabledReq{
		RuleID:  created.ID,
		Enabled: false,
	})
	if err != nil {
		t.Fatalf("SetEnabled: %v", err)
	}
	if disabled.Enabled {
		t.Fatal("rule still enabled after disable")
	}
	if disabled.ActiveVersion != created.ActiveVersion {
		t.Fatalf("disable created a new version: %s -> %s", created.ActiveVersion, disabled.ActiveVersion)
	}

	active, err = repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules after disable: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("disabled rule still injected: %+v", active)
	}
}

func TestTeamRuleUsecaseRejectsPathNameAndEmptyContent(t *testing.T) {
	ctx := context.Background()
	uc := &teamRuleUsecase{db: newRuleTestClient(t, "team-rule-validate")}
	user := testTeamUser()

	if _, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "../x", Content: "ok"}); err == nil {
		t.Fatal("expected path name to fail")
	}
	if _, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "ok", Content: "   "}); err == nil {
		t.Fatal("expected empty content to fail")
	}
	if _, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "ok", Content: strings.Repeat("a", (1<<20)+1)}); err == nil {
		t.Fatal("expected oversized content to fail")
	}
}

func TestTeamRuleUsecaseSoftDeleteAllowsSameNameAndSkipsInjection(t *testing.T) {
	ctx := context.Background()
	client := newRuleTestClient(t, "team-rule-delete")
	uc := &teamRuleUsecase{db: client}
	user := testTeamUser()

	created, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "same", Content: "# v1\n"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := uc.Delete(ctx, user, &domain.DeleteTeamRuleReq{RuleID: created.ID}); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	listed, err := uc.List(ctx, user)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(listed.Rules) != 0 {
		t.Fatalf("soft-deleted rule still listed: %+v", listed.Rules)
	}

	again, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "same", Content: "# v2\n"})
	if err != nil {
		t.Fatalf("Add same name after delete: %v", err)
	}
	if again.ID == created.ID {
		t.Fatal("recreated rule reused deleted id")
	}

	repo := agentresource.NewRepo(client)
	active, err := repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules: %v", err)
	}
	if len(active) != 1 || active[0].Content != "# v2\n" {
		t.Fatalf("active after recreate = %+v", active)
	}
}

func TestTeamRuleUsecaseEditContentCreatesVersionWithoutChangingEnabled(t *testing.T) {
	ctx := context.Background()
	uc := &teamRuleUsecase{db: newRuleTestClient(t, "team-rule-edit")}
	user := testTeamUser()

	created, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "edit-me", Content: "# old\n"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	updated, err := uc.Update(ctx, user, &domain.UpdateTeamRuleReq{
		RuleID:  created.ID,
		Content: "# new\n",
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Content != "# new\n" {
		t.Fatalf("content = %q", updated.Content)
	}
	versions, err := uc.ListVersions(ctx, user, &domain.ListTeamRuleVersionsReq{RuleID: created.ID})
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(versions.Versions) != 2 {
		t.Fatalf("versions = %d, want 2 after content edit", len(versions.Versions))
	}
	if updated.Enabled != created.Enabled {
		t.Fatal("edit changed enabled")
	}
}

func TestTeamRuleUsecaseRestoreSwitchesActiveVersionWithoutNewVersion(t *testing.T) {
	ctx := context.Background()
	client := newRuleTestClient(t, "team-rule-restore")
	uc := &teamRuleUsecase{db: client}
	user := testTeamUser()

	created, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "restore-me", Content: "# old\n"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	updated, err := uc.Update(ctx, user, &domain.UpdateTeamRuleReq{RuleID: created.ID, Content: "# new\n"})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	versions, err := uc.ListVersions(ctx, user, &domain.ListTeamRuleVersionsReq{RuleID: created.ID})
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(versions.Versions) != 2 {
		t.Fatalf("versions = %d, want 2", len(versions.Versions))
	}
	var oldID uuid.UUID
	for _, v := range versions.Versions {
		if v.Version == created.ActiveVersion {
			oldID = v.ID
		}
	}
	if oldID == uuid.Nil {
		t.Fatal("old version id not found")
	}

	restored, err := uc.Restore(ctx, user, &domain.RestoreTeamRuleReq{RuleID: created.ID, VersionID: oldID})
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if restored.Content != "# old\n" {
		t.Fatalf("restored content = %q, want old", restored.Content)
	}
	if restored.Enabled != updated.Enabled {
		t.Fatal("restore changed enabled")
	}
	after, err := uc.ListVersions(ctx, user, &domain.ListTeamRuleVersionsReq{RuleID: created.ID})
	if err != nil {
		t.Fatalf("ListVersions after restore: %v", err)
	}
	if len(after.Versions) != 2 {
		t.Fatalf("restore created a new version: %d", len(after.Versions))
	}

	repo := agentresource.NewRepo(client)
	active, err := repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules: %v", err)
	}
	if len(active) != 1 || active[0].Content != "# old\n" {
		t.Fatalf("injection after restore = %+v", active)
	}
}

func TestTeamRuleUsecaseRestoreRejectsUnknownVersion(t *testing.T) {
	ctx := context.Background()
	uc := &teamRuleUsecase{db: newRuleTestClient(t, "team-rule-restore-missing")}
	user := testTeamUser()

	created, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "restore-miss", Content: "# v1\n"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := uc.Restore(ctx, user, &domain.RestoreTeamRuleReq{RuleID: created.ID, VersionID: uuid.New()}); err == nil {
		t.Fatal("expected unknown version restore to fail")
	}
}

func TestTeamRuleUsecaseRestoreKeepsDisabled(t *testing.T) {
	ctx := context.Background()
	client := newRuleTestClient(t, "team-rule-restore-disabled")
	uc := &teamRuleUsecase{db: client}
	user := testTeamUser()

	created, err := uc.Add(ctx, user, &domain.AddTeamRuleReq{Name: "restore-disabled", Content: "# old\n"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	updated, err := uc.Update(ctx, user, &domain.UpdateTeamRuleReq{RuleID: created.ID, Content: "# new\n"})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	disabled, err := uc.SetEnabled(ctx, user, &domain.SetTeamRuleEnabledReq{RuleID: created.ID, Enabled: false})
	if err != nil {
		t.Fatalf("SetEnabled: %v", err)
	}
	if disabled.Enabled {
		t.Fatal("expected disabled")
	}
	versions, err := uc.ListVersions(ctx, user, &domain.ListTeamRuleVersionsReq{RuleID: created.ID})
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	var oldID uuid.UUID
	for _, v := range versions.Versions {
		if v.Version == created.ActiveVersion {
			oldID = v.ID
		}
	}
	if oldID == uuid.Nil {
		t.Fatal("old version id not found")
	}
	restored, err := uc.Restore(ctx, user, &domain.RestoreTeamRuleReq{RuleID: created.ID, VersionID: oldID})
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if restored.Enabled {
		t.Fatal("restore re-enabled a disabled rule")
	}
	if restored.Content != "# old\n" {
		t.Fatalf("content = %q", restored.Content)
	}
	if restored.Content == updated.Content {
		t.Fatal("restore did not switch back to old content")
	}
	after, err := uc.ListVersions(ctx, user, &domain.ListTeamRuleVersionsReq{RuleID: created.ID})
	if err != nil {
		t.Fatalf("ListVersions after restore: %v", err)
	}
	if len(after.Versions) != 2 {
		t.Fatalf("restore created a new version: %d", len(after.Versions))
	}

	repo := agentresource.NewRepo(client)
	active, err := repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("disabled restored rule still injected: %+v", active)
	}
}
