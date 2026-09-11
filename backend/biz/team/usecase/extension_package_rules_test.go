package usecase

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentrule"
	"github.com/chaitin/MonkeyCode/backend/db/agentruleversion"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
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
	version, err := client.AgentRuleVersion.Get(ctx, *rule.ActiveVersionID)
	if err != nil {
		t.Fatal(err)
	}
	assertRuleVersionFormat(t, version.Version)
	if version.Version == pkg.Version {
		t.Fatalf("rule version should not use package version %q", pkg.Version)
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
	previous := client.AgentRule.Query().OnlyX(ctx)
	pkg.Version = "1.0.1"
	pkg.Rules[0].Name = "renamed-base"
	pkg.Rules[0].Description = "updated"
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
	if count != 1 {
		t.Fatalf("version count = %d", count)
	}
	versions, err := client.AgentRuleVersion.Query().All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range versions {
		assertRuleVersionFormat(t, version.Version)
		if strings.HasPrefix(version.Version, "1.0.") {
			t.Fatalf("rule version should not use package version %q", version.Version)
		}
	}
	rule, err := client.AgentRule.Query().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rule.ID != previous.ID || rule.Name != "renamed-base" || rule.Description != "updated" {
		t.Fatalf("updated rule = %#v", rule)
	}
	if rule.ExtensionVersion == nil || *rule.ExtensionVersion != pkg.Version {
		t.Fatalf("extension version = %v", rule.ExtensionVersion)
	}
	active, err := client.AgentRuleVersion.Get(ctx, *rule.ActiveVersionID)
	if err != nil {
		t.Fatal(err)
	}
	assertRuleVersionFormat(t, active.Version)
	if active.Content != "v2" {
		t.Fatalf("active content = %q, want v2", active.Content)
	}
	result, err = (&extensionRuleImporter{db: client}).ImportRules(ctx, userID, pkg)
	if err != nil {
		t.Fatal(err)
	}
	if result != (domain.ExtensionRuleImportResult{}) {
		t.Fatalf("unchanged import result = %#v", result)
	}
	if count := client.AgentRuleVersion.Query().CountX(ctx); count != 1 {
		t.Fatalf("version count after repeated import = %d, want 1", count)
	}
	unchanged := client.AgentRule.GetX(ctx, rule.ID)
	if unchanged.ActiveVersionID == nil || *unchanged.ActiveVersionID != active.ID || !unchanged.UpdatedAt.Equal(rule.UpdatedAt) {
		t.Fatalf("unchanged rule was rewritten: %#v", unchanged)
	}
}

func TestExtensionRuleImporterReimportsChanges(t *testing.T) {
	for _, change := range []string{"content", "name", "description", "version", "history", "deleted", "missing-active", "database-content"} {
		t.Run(change, func(t *testing.T) {
			ctx := context.Background()
			client := newRuleImportTestClient(t)
			importer := &extensionRuleImporter{db: client}
			userID := uuid.New()
			pkg := &parsedExtensionPackage{
				PackageID: "pack",
				Version:   "1.0.0",
				Rules:     []parsedExtensionRule{{RuleID: "base", Name: "base", Description: "base", Content: "original"}},
			}
			if _, err := importer.ImportRules(ctx, userID, pkg); err != nil {
				t.Fatal(err)
			}
			original := client.AgentRule.Query().OnlyX(ctx)
			switch change {
			case "content":
				pkg.Rules[0].Content = "updated"
			case "name":
				pkg.Rules[0].Name = "renamed"
			case "description":
				pkg.Rules[0].Description = "updated"
			case "version":
				pkg.Version = "1.0.1"
			case "history":
				client.AgentRuleVersion.Create().SetRuleID(original.ID).SetVersion("20260623115903").SetContent("historical").SaveX(ctx)
			case "deleted":
				client.AgentRule.UpdateOne(original).SetIsDeleted(true).ExecX(ctx)
			case "missing-active":
				client.AgentRule.UpdateOne(original).ClearActiveVersionID().ExecX(ctx)
			case "database-content":
				client.AgentRuleVersion.UpdateOneID(*original.ActiveVersionID).SetContent("manual change").ExecX(ctx)
			}

			result, err := importer.ImportRules(ctx, userID, pkg)
			if err != nil {
				t.Fatal(err)
			}
			if result.CreatedRules+result.UpdatedRules != 1 {
				t.Fatalf("changed import result = %#v", result)
			}
			rule := client.AgentRule.Query().OnlyX(ctx)
			version := client.AgentRuleVersion.Query().OnlyX(ctx)
			if rule.IsDeleted || rule.ActiveVersionID == nil || *rule.ActiveVersionID != version.ID || version.ID == *original.ActiveVersionID {
				t.Fatalf("changed rule was not replaced: %#v", rule)
			}
			if rule.Name != pkg.Rules[0].Name || rule.Description != pkg.Rules[0].Description || rule.ExtensionVersion == nil || *rule.ExtensionVersion != pkg.Version || version.Content != pkg.Rules[0].Content {
				t.Fatalf("rule does not match package: rule=%#v version=%#v", rule, version)
			}
		})
	}
}

func TestExtensionRuleImporterReplacesPackageRules(t *testing.T) {
	ctx := context.Background()
	client := newRuleImportTestClient(t)
	importer := &extensionRuleImporter{db: client}
	userID := uuid.New()
	pkg := &parsedExtensionPackage{
		PackageID: "pack",
		Version:   "1.0.0",
		Rules: []parsedExtensionRule{
			{RuleID: "keep", Name: "keep", Content: "old"},
			{RuleID: "remove", Name: "remove", Content: "removed"},
			{RuleID: "deleted", Name: "deleted", Content: "deleted"},
		},
	}
	if _, err := importer.ImportRules(ctx, userID, pkg); err != nil {
		t.Fatal(err)
	}
	client.AgentRule.Update().Where(agentrule.ExtensionRuleIDEQ("deleted")).SetIsDeleted(true).ExecX(ctx)
	keep := client.AgentRule.Query().Where(agentrule.ExtensionRuleIDEQ("keep")).OnlyX(ctx)
	client.AgentRuleVersion.Create().SetRuleID(keep.ID).SetVersion("20260623115903").SetContent("historical").SaveX(ctx)
	other := &parsedExtensionPackage{
		PackageID: "other",
		Version:   "1.0.0",
		Rules:     []parsedExtensionRule{{RuleID: "keep", Name: "other", Content: "other"}},
	}
	if _, err := importer.ImportRules(ctx, userID, other); err != nil {
		t.Fatal(err)
	}
	otherRule := client.AgentRule.Query().Where(agentrule.ExtensionPackageIDEQ("other")).OnlyX(ctx)
	manual := client.AgentRule.Create().SetName("manual").SetCreatedBy(userID).SaveX(ctx)
	manualVersion := client.AgentRuleVersion.Create().SetRuleID(manual.ID).SetVersion("20260623115903").SetContent("manual").SaveX(ctx)
	client.AgentRule.UpdateOne(manual).SetActiveVersionID(manualVersion.ID).ExecX(ctx)

	pkg.Version = "1.0.1"
	pkg.Rules = []parsedExtensionRule{
		{RuleID: "keep", Name: "keep", Content: "latest"},
		{RuleID: "new", Name: "remove", Content: "new"},
	}
	result, err := importer.ImportRules(ctx, userID, pkg)
	if err != nil {
		t.Fatal(err)
	}
	if result.CreatedRules != 1 || result.UpdatedRules != 1 {
		t.Fatalf("result = %#v", result)
	}
	rules := client.AgentRule.Query().Where(agentrule.ExtensionPackageIDEQ(pkg.PackageID)).AllX(ctx)
	if len(rules) != 2 {
		t.Fatalf("package rule count = %d, want 2", len(rules))
	}
	for _, rule := range rules {
		if rule.IsDeleted || rule.ExtensionRuleID == nil || rule.ActiveVersionID == nil {
			t.Fatalf("unexpected rule = %#v", rule)
		}
		want := "new"
		if *rule.ExtensionRuleID == "keep" {
			want = "latest"
			if rule.ID != keep.ID {
				t.Fatalf("retained rule ID = %s, want %s", rule.ID, keep.ID)
			}
		} else if *rule.ExtensionRuleID != "new" {
			t.Fatalf("stale rule retained: %s", *rule.ExtensionRuleID)
		}
		versions := client.AgentRuleVersion.Query().Where(agentruleversion.RuleID(rule.ID)).AllX(ctx)
		if len(versions) != 1 || versions[0].ID != *rule.ActiveVersionID || versions[0].Content != want {
			t.Fatalf("versions for %s = %#v", rule.Name, versions)
		}
	}
	if count := client.AgentRule.Query().CountX(ctx); count != 4 {
		t.Fatalf("total rule count = %d, want 4", count)
	}
	if count := client.AgentRuleVersion.Query().CountX(ctx); count != 4 {
		t.Fatalf("total version count = %d, want 4", count)
	}
	if got := client.AgentRule.GetX(ctx, otherRule.ID); got.ActiveVersionID == nil || *got.ActiveVersionID != *otherRule.ActiveVersionID {
		t.Fatal("other package rule changed")
	}
	if got := client.AgentRule.GetX(ctx, manual.ID); got.ActiveVersionID == nil || *got.ActiveVersionID != manualVersion.ID {
		t.Fatal("manual rule changed")
	}

	pkg, err = parseExtensionPackage(makeExtensionZip(t, map[string]string{
		"manifest.json": `{"package_id":"pack","version":"1.0.2","rules":[]}`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := importer.ImportRules(ctx, userID, pkg); err != nil {
		t.Fatal(err)
	}
	if count := client.AgentRule.Query().Where(agentrule.ExtensionPackageIDEQ(pkg.PackageID)).CountX(ctx); count != 0 {
		t.Fatalf("rule count after empty replacement = %d, want 0", count)
	}
	if count := client.AgentRuleVersion.Query().CountX(ctx); count != 2 {
		t.Fatalf("version count after empty replacement = %d, want 2", count)
	}
}

func TestExtensionRuleImporterRollsBackReplacement(t *testing.T) {
	ctx := context.Background()
	client := newRuleImportTestClient(t)
	importer := &extensionRuleImporter{db: client}
	userID := uuid.New()
	pkg := &parsedExtensionPackage{
		PackageID: "pack",
		Version:   "1.0.0",
		Rules:     []parsedExtensionRule{{RuleID: "old", Name: "old", Content: "original"}},
	}
	if _, err := importer.ImportRules(ctx, userID, pkg); err != nil {
		t.Fatal(err)
	}
	original := client.AgentRule.Query().OnlyX(ctx)
	client.AgentRule.Create().SetName("conflict").SetCreatedBy(userID).SaveX(ctx)
	pkg.Version = "1.0.1"
	pkg.Rules = []parsedExtensionRule{
		{RuleID: "new", Name: "new", Content: "new"},
		{RuleID: "conflict", Name: "conflict", Content: "conflict"},
	}
	result, err := importer.ImportRules(ctx, userID, pkg)
	if err == nil {
		t.Fatal("expected name conflict")
	}
	if result != (domain.ExtensionRuleImportResult{}) {
		t.Fatalf("rolled back result = %#v", result)
	}
	rule := client.AgentRule.GetX(ctx, original.ID)
	if rule.ActiveVersionID == nil || *rule.ActiveVersionID != *original.ActiveVersionID || *rule.ExtensionVersion != "1.0.0" {
		t.Fatalf("original rule changed after failed import: %#v", rule)
	}
	if count := client.AgentRule.Query().CountX(ctx); count != 2 {
		t.Fatalf("rule count after rollback = %d, want 2", count)
	}
	version := client.AgentRuleVersion.Query().OnlyX(ctx)
	if version.ID != *original.ActiveVersionID || version.Content != "original" {
		t.Fatalf("original version changed after failed import: %#v", version)
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

func assertRuleVersionFormat(t *testing.T, version string) {
	t.Helper()
	if len(version) != 14 {
		t.Fatalf("rule version = %q, want 14-char timestamp", version)
	}
	if _, err := time.Parse(VersionFormat, version); err != nil {
		t.Fatalf("rule version = %q does not match %s: %v", version, VersionFormat, err)
	}
}
