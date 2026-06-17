package agentresource

import (
	"context"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentpluginrepo"
	"github.com/chaitin/MonkeyCode/backend/db/agentskillrepo"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	enttypes "github.com/chaitin/MonkeyCode/backend/ent/types"
)

func newTestDB(t *testing.T, name string) *db.Client {
	t.Helper()
	dsn := "file:" + name + "?mode=memory&cache=shared&_fk=1"
	client := enttest.Open(t, "sqlite3", dsn)
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// seedRule creates a rule + (optionally) a single version, and points
// active_version_id at it. The content argument is the seed value placed in
// agent_rule_versions.content (rule content lives entirely in the DB; no S3
// involvement for rules).
func seedRule(t *testing.T, ctx context.Context, client *db.Client, name string, isDeleted bool, content string, withVersion bool) (ruleID, versionID uuid.UUID) {
	t.Helper()
	creator := uuid.New()
	rule, err := client.AgentRule.Create().
		SetName(name).
		SetCreatedBy(creator).
		SetIsDeleted(isDeleted).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed rule %s: %v", name, err)
	}
	if !withVersion {
		return rule.ID, uuid.Nil
	}
	v, err := client.AgentRuleVersion.Create().
		SetRuleID(rule.ID).
		SetVersion("v1").
		SetContent(content).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed rule version %s: %v", name, err)
	}
	if _, err := client.AgentRule.UpdateOneID(rule.ID).SetActiveVersionID(v.ID).Save(ctx); err != nil {
		t.Fatalf("set active version for rule %s: %v", name, err)
	}
	return rule.ID, v.ID
}

type skillSeed struct {
	name            string
	isDeleted       bool
	isOrphan        bool
	isForceDelivery bool
	withVersion     bool // if false, active_version_id stays nil
}

func seedSkill(t *testing.T, ctx context.Context, client *db.Client, repoID uuid.UUID, s skillSeed) uuid.UUID {
	t.Helper()
	creator := uuid.New()
	sk, err := client.AgentSkill.Create().
		SetRepoID(repoID).
		SetName(s.name).
		SetCreatedBy(creator).
		SetIsDeleted(s.isDeleted).
		SetIsOrphan(s.isOrphan).
		SetIsForceDelivery(s.isForceDelivery).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed skill %s: %v", s.name, err)
	}
	if !s.withVersion {
		return sk.ID
	}
	v, err := client.AgentSkillVersion.Create().
		SetResourceID(sk.ID).
		SetVersion("v1").
		SetS3Key("skills/" + s.name + ".tgz").
		SetParsedMeta(enttypes.SkillParsedMeta{Description: s.name + " desc"}).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed skill version %s: %v", s.name, err)
	}
	if _, err := client.AgentSkill.UpdateOneID(sk.ID).SetActiveVersionID(v.ID).Save(ctx); err != nil {
		t.Fatalf("set active version for skill %s: %v", s.name, err)
	}
	return sk.ID
}

func seedSkillRepo(t *testing.T, ctx context.Context, client *db.Client) uuid.UUID {
	t.Helper()
	r, err := client.AgentSkillRepo.Create().
		SetName("default").
		SetSourceType(agentskillrepo.SourceTypeGithub).
		SetGithubURL("https://example.com/skills.git").
		SetCreatedBy(uuid.New()).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed skill repo: %v", err)
	}
	return r.ID
}

func seedPluginRepo(t *testing.T, ctx context.Context, client *db.Client) uuid.UUID {
	t.Helper()
	r, err := client.AgentPluginRepo.Create().
		SetName("default").
		SetSourceType(agentpluginrepo.SourceTypeGithub).
		SetGithubURL("https://example.com/plugins.git").
		SetCreatedBy(uuid.New()).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed plugin repo: %v", err)
	}
	return r.ID
}

type pluginSeed struct {
	name            string
	isDeleted       bool
	isOrphan        bool
	isForceDelivery bool
	withVersion     bool
	entry           string
}

func seedPlugin(t *testing.T, ctx context.Context, client *db.Client, repoID uuid.UUID, p pluginSeed) uuid.UUID {
	t.Helper()
	creator := uuid.New()
	pl, err := client.AgentPlugin.Create().
		SetRepoID(repoID).
		SetName(p.name).
		SetCreatedBy(creator).
		SetIsDeleted(p.isDeleted).
		SetIsOrphan(p.isOrphan).
		SetIsForceDelivery(p.isForceDelivery).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed plugin %s: %v", p.name, err)
	}
	if !p.withVersion {
		return pl.ID
	}
	entry := p.entry
	if entry == "" {
		entry = "index.js"
	}
	v, err := client.AgentPluginVersion.Create().
		SetResourceID(pl.ID).
		SetVersion("v1").
		SetS3Key("plugins/" + p.name + ".tgz").
		SetParsedMeta(enttypes.PluginParsedMeta{Entry: entry}).
		Save(ctx)
	if err != nil {
		t.Fatalf("seed plugin version %s: %v", p.name, err)
	}
	if _, err := client.AgentPlugin.UpdateOneID(pl.ID).SetActiveVersionID(v.ID).Save(ctx); err != nil {
		t.Fatalf("set active version for plugin %s: %v", p.name, err)
	}
	return pl.ID
}

// ---- ListActiveRules ----

func TestListActiveRules_ReturnsContent(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-rules-content")

	seedRule(t, ctx, client, "rule-a", false, "hello", true)

	repo := NewRepo(client)
	out, err := repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules: %v", err)
	}
	if len(out) != 1 || out[0].Name != "rule-a" {
		t.Fatalf("expected rule-a only, got %+v", out)
	}
	if out[0].Content != "hello" {
		t.Fatalf("expected content %q, got %q", "hello", out[0].Content)
	}
}

func TestListActiveRules_SkipsDeleted(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-rules-deleted")

	seedRule(t, ctx, client, "alive", false, "a", true)
	seedRule(t, ctx, client, "tombstone", true, "b", true)

	repo := NewRepo(client)
	out, err := repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules: %v", err)
	}
	if len(out) != 1 || out[0].Name != "alive" {
		t.Fatalf("expected only alive rule, got %+v", out)
	}
}

func TestListActiveRules_SkipsRuleWithoutActiveVersion(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-rules-nover")

	seedRule(t, ctx, client, "no-active", false, "", false)

	repo := NewRepo(client)
	out, err := repo.ListActiveRules(ctx)
	if err != nil {
		t.Fatalf("ListActiveRules: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("expected no rules, got %+v", out)
	}
}

// ---- ListActiveSkills ----

func TestListActiveSkills_UnionWithForceDelivery(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-skills-union")
	repoID := seedSkillRepo(t, ctx, client)

	picked := seedSkill(t, ctx, client, repoID, skillSeed{name: "picked", withVersion: true})
	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "force", isForceDelivery: true, withVersion: true})
	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "ignored", withVersion: true}) // not selected, not forced

	repo := NewRepo(client)
	out, err := repo.ListActiveSkills(ctx, []uuid.UUID{picked})
	if err != nil {
		t.Fatalf("ListActiveSkills: %v", err)
	}
	names := skillNames(out)
	if !equalStringSet(names, []string{"force", "picked"}) {
		t.Fatalf("expected {force, picked}, got %v", names)
	}
}

func TestListActiveSkills_FilterDeleted(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-skills-deleted")
	repoID := seedSkillRepo(t, ctx, client)

	gone := seedSkill(t, ctx, client, repoID, skillSeed{name: "gone", isDeleted: true, withVersion: true})
	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "force-gone", isDeleted: true, isForceDelivery: true, withVersion: true})

	repo := NewRepo(client)
	out, err := repo.ListActiveSkills(ctx, []uuid.UUID{gone})
	if err != nil {
		t.Fatalf("ListActiveSkills: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("expected no skills (all deleted), got %+v", out)
	}
}

func TestListActiveSkills_KeepsOrphans(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-skills-orphan")
	repoID := seedSkillRepo(t, ctx, client)

	orphan := seedSkill(t, ctx, client, repoID, skillSeed{name: "orphan", isOrphan: true, withVersion: true})

	repo := NewRepo(client)
	out, err := repo.ListActiveSkills(ctx, []uuid.UUID{orphan})
	if err != nil {
		t.Fatalf("ListActiveSkills: %v", err)
	}
	if len(out) != 1 || out[0].Name != "orphan" || !out[0].IsOrphan {
		t.Fatalf("expected single orphan skill kept, got %+v", out)
	}
}

func TestListActiveSkills_EmptyUserIDs_OnlyForce(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-skills-emptyuser")
	repoID := seedSkillRepo(t, ctx, client)

	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "force-1", isForceDelivery: true, withVersion: true})
	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "not-force", withVersion: true})

	repo := NewRepo(client)
	out, err := repo.ListActiveSkills(ctx, nil)
	if err != nil {
		t.Fatalf("ListActiveSkills: %v", err)
	}
	if len(out) != 1 || out[0].Name != "force-1" {
		t.Fatalf("expected only force-1, got %+v", out)
	}
}

func TestListActiveSkills_SkipsNoActiveVersion(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-skills-nover")
	repoID := seedSkillRepo(t, ctx, client)

	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "force-noversion", isForceDelivery: true, withVersion: false})

	repo := NewRepo(client)
	out, err := repo.ListActiveSkills(ctx, nil)
	if err != nil {
		t.Fatalf("ListActiveSkills: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("expected no skills, got %+v", out)
	}
}

// ---- ListActivePlugins ----

func TestListActivePlugins_UnionAndEntry(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-plugins-union")
	repoID := seedPluginRepo(t, ctx, client)

	picked := seedPlugin(t, ctx, client, repoID, pluginSeed{name: "picked", withVersion: true, entry: "main.js"})
	_ = seedPlugin(t, ctx, client, repoID, pluginSeed{name: "force", isForceDelivery: true, withVersion: true, entry: "force.js"})
	_ = seedPlugin(t, ctx, client, repoID, pluginSeed{name: "ignored", withVersion: true})

	repo := NewRepo(client)
	out, err := repo.ListActivePlugins(ctx, []uuid.UUID{picked})
	if err != nil {
		t.Fatalf("ListActivePlugins: %v", err)
	}
	got := map[string]string{}
	for _, p := range out {
		got[p.Name] = p.Entry
	}
	if len(got) != 2 || got["picked"] != "main.js" || got["force"] != "force.js" {
		t.Fatalf("expected picked/main.js + force/force.js, got %+v", got)
	}
}

// ---- ListSkillsForListing ----

func TestListSkillsForListing_ExcludesOrphans(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-skills-listing")
	repoID := seedSkillRepo(t, ctx, client)

	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "active", withVersion: true})
	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "orphan", isOrphan: true, withVersion: true})
	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "deleted", isDeleted: true, withVersion: true})
	_ = seedSkill(t, ctx, client, repoID, skillSeed{name: "no-active", withVersion: false})

	repo := NewRepo(client)
	out, err := repo.ListSkillsForListing(ctx)
	if err != nil {
		t.Fatalf("ListSkillsForListing: %v", err)
	}
	names := listingNames(out)
	if !equalStringSet(names, []string{"active"}) {
		t.Fatalf("expected only {active}, got %v", names)
	}
	if out[0].Version != "v1" {
		t.Fatalf("expected version v1, got %q", out[0].Version)
	}
}

// ---- ListPluginsForListing ----

func TestListPluginsForListing_ExcludesDeleted(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-plugins-listing")
	repoID := seedPluginRepo(t, ctx, client)

	_ = seedPlugin(t, ctx, client, repoID, pluginSeed{name: "active", withVersion: true})
	_ = seedPlugin(t, ctx, client, repoID, pluginSeed{name: "orphan", isOrphan: true, withVersion: true})
	_ = seedPlugin(t, ctx, client, repoID, pluginSeed{name: "deleted", isDeleted: true, withVersion: true})

	repo := NewRepo(client)
	out, err := repo.ListPluginsForListing(ctx)
	if err != nil {
		t.Fatalf("ListPluginsForListing: %v", err)
	}
	names := listingNames(out)
	if !equalStringSet(names, []string{"active"}) {
		t.Fatalf("expected only {active}, got %v", names)
	}
}

func TestListPluginsForListing_CarriesEntry(t *testing.T) {
	ctx := context.Background()
	client := newTestDB(t, "agentresource-plugins-listing-entry")
	repoID := seedPluginRepo(t, ctx, client)

	_ = seedPlugin(t, ctx, client, repoID, pluginSeed{name: "alpha", withVersion: true, entry: "dist/index.js"})

	repo := NewRepo(client)
	out, err := repo.ListPluginsForListing(ctx)
	if err != nil {
		t.Fatalf("ListPluginsForListing: %v", err)
	}
	if len(out) != 1 || out[0].Name != "alpha" {
		t.Fatalf("expected one plugin alpha, got %+v", out)
	}
	if out[0].Entry != "dist/index.js" {
		t.Fatalf("expected entry dist/index.js, got %q", out[0].Entry)
	}
}

// ---- helpers ----

func skillNames(items []*SkillWithVersion) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.Name)
	}
	return out
}

func listingNames(items []*ResourceListItem) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.Name)
	}
	return out
}

func equalStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	set := map[string]int{}
	for _, x := range a {
		set[x]++
	}
	for _, x := range b {
		set[x]--
		if set[x] < 0 {
			return false
		}
	}
	return true
}
