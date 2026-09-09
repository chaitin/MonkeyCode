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
