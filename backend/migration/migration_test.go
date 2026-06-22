package migration

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrationsUseDeletedAtForSoftDelete(t *testing.T) {
	files, err := filepath.Glob("*.sql")
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		if strings.Contains(string(data), "delete_time") {
			t.Fatalf("%s references delete_time; soft delete column is deleted_at", file)
		}
	}
}

func TestMigrationsWidenUserIdentityIDForOIDC(t *testing.T) {
	data, err := os.ReadFile("000015_alter_user_identities_identity_id_text.up.sql")
	if err != nil {
		t.Fatalf("read identity_id migration: %v", err)
	}
	sql := strings.ToLower(string(data))
	if !strings.Contains(sql, "alter table user_identities") ||
		!strings.Contains(sql, "alter column identity_id") ||
		!strings.Contains(sql, "type text") {
		t.Fatalf("identity_id migration must alter user_identities.identity_id to text")
	}
}

func TestExtensionPackageMigrationDefinesArchiveTable(t *testing.T) {
	data, err := os.ReadFile("000018_extension_package_resources.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(data)
	for _, want := range []string{
		"ALTER TABLE skills ADD COLUMN IF NOT EXISTS extension_package_id",
		"ALTER TABLE skills ADD COLUMN IF NOT EXISTS extension_skill_id",
		"ALTER TABLE images ADD COLUMN IF NOT EXISTS extension_package_id",
		"ALTER TABLE images ADD COLUMN IF NOT EXISTS extension_image_id",
		"CREATE TABLE IF NOT EXISTS team_extension_image_archives",
		"unique_idx_team_extension_image_archives_identity",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("migration missing %q", want)
		}
	}
}

func TestTeamMCPHubMigrationAddsTeamScopeAndCalls(t *testing.T) {
	data, err := os.ReadFile("000020_team_mcp_hub.up.sql")
	if err != nil {
		t.Fatalf("read team mcp migration: %v", err)
	}
	sql := string(data)
	for _, want := range []string{
		"ALTER TABLE mcp_upstreams",
		"ADD COLUMN IF NOT EXISTS team_id uuid",
		"team_group_mcp_upstreams",
		"mcp_tool_calls",
		"'team'",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("team mcp migration missing %q", want)
		}
	}
}

func TestAgentRulesExtensionSourceMigrationExists(t *testing.T) {
	up, err := os.ReadFile("000021_agent_rules_extension_source.up.sql")
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	for _, want := range []string{
		"extension_package_id",
		"extension_rule_id",
		"extension_version",
		"idx_agent_rules_extension_source",
	} {
		if !strings.Contains(string(up), want) {
			t.Fatalf("up migration missing %q", want)
		}
	}

	down, err := os.ReadFile("000021_agent_rules_extension_source.down.sql")
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	if !strings.Contains(string(down), "DROP COLUMN IF EXISTS extension_package_id") {
		t.Fatalf("down migration does not drop extension source columns")
	}
}
