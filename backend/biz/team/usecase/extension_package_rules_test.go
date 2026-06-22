package usecase

import (
	"context"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
)

func newRuleImportTestClient(t *testing.T) *db.Client {
	t.Helper()
	client := enttest.Open(t, "sqlite3", "file:extension-rule-import?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestExtensionRuleImporterCreatesGlobalRule(t *testing.T) {
	ctx := context.Background()
	client := newRuleImportTestClient(t)
	importer := &extensionRuleImporter{db: client}
	userID := uuid.New()
	pkg := &parsedExtensionPackage{
		PackageID: "pack",
		Version:   "1.0.0",
		Rules: []parsedExtensionRule{{
			RuleID:      "codex-base",
			Name:        "codex-base",
			Description: "base",
			Content:     "# Base\n",
		}},
	}

	result, err := importer.ImportRules(ctx, userID, pkg)
	if err != nil {
		t.Fatal(err)
	}
	if result.CreatedRules != 1 || result.UpdatedRules != 0 {
		t.Fatalf("result = %#v", result)
	}
	rule, err := client.AgentRule.Query().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rule.ScopeType != "global" || rule.ScopeID != "global" {
		t.Fatalf("scope = %s/%s", rule.ScopeType, rule.ScopeID)
	}
	if rule.ExtensionPackageID == nil || *rule.ExtensionPackageID != "pack" {
		t.Fatalf("extension package id = %#v", rule.ExtensionPackageID)
	}
	if rule.ExtensionRuleID == nil || *rule.ExtensionRuleID != "codex-base" {
		t.Fatalf("extension rule id = %#v", rule.ExtensionRuleID)
	}
	if rule.ActiveVersionID == nil {
		t.Fatal("active version id is nil")
	}
}

func TestExtensionRuleImporterUpdatesSamePackageRule(t *testing.T) {
	ctx := context.Background()
	client := newRuleImportTestClient(t)
	importer := &extensionRuleImporter{db: client}
	userID := uuid.New()

	pkg := &parsedExtensionPackage{
		PackageID: "pack",
		Version:   "1.0.0",
		Rules: []parsedExtensionRule{{
			RuleID:  "codex-base",
			Name:    "codex-base",
			Content: "v1",
		}},
	}
	if _, err := importer.ImportRules(ctx, userID, pkg); err != nil {
		t.Fatal(err)
	}
	pkg.Version = "1.0.1"
	pkg.Rules[0].Content = "v2"
	result, err := importer.ImportRules(ctx, userID, pkg)
	if err != nil {
		t.Fatal(err)
	}
	if result.CreatedRules != 0 || result.UpdatedRules != 1 {
		t.Fatalf("result = %#v", result)
	}
	count, err := client.AgentRuleVersion.Query().Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("version count = %d", count)
	}
}

func TestExtensionRuleImporterRejectsNameConflict(t *testing.T) {
	ctx := context.Background()
	client := newRuleImportTestClient(t)
	importer := &extensionRuleImporter{db: client}
	userID := uuid.New()

	first := &parsedExtensionPackage{
		PackageID: "pack-a",
		Version:   "1.0.0",
		Rules: []parsedExtensionRule{{
			RuleID:  "codex-base",
			Name:    "codex-base",
			Content: "a",
		}},
	}
	if _, err := importer.ImportRules(ctx, userID, first); err != nil {
		t.Fatal(err)
	}
	second := &parsedExtensionPackage{
		PackageID: "pack-b",
		Version:   "1.0.0",
		Rules: []parsedExtensionRule{{
			RuleID:  "codex-base",
			Name:    "codex-base",
			Content: "b",
		}},
	}
	if _, err := importer.ImportRules(ctx, userID, second); err == nil {
		t.Fatal("ImportRules should reject same rule name from different package")
	}
}
