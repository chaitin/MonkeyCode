package repo

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/mcptool"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/google/uuid"
)

func TestListUserUpstreamsSkipsDisabledPlatformResources(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user-mcp-upstreams-disabled-tools?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	uid := uuid.New()
	if _, err := client.User.Create().
		SetID(uid).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	upstreamID := uuid.New()
	if _, err := client.MCPUpstream.Create().
		SetID(upstreamID).
		SetName("Platform Docs").
		SetSlug("platform-docs").
		SetScope("platform").
		SetType("server").
		SetURL("https://example.com/mcp").
		SetHeaders(map[string]string{}).
		Save(ctx); err != nil {
		t.Fatalf("create upstream: %v", err)
	}

	enabledToolID := uuid.New()
	if _, err := client.MCPTool.Create().
		SetID(enabledToolID).
		SetUpstreamID(upstreamID).
		SetName("search_docs").
		SetNamespacedName("platform-docs__search_docs").
		SetScope("platform").
		SetInputSchema(map[string]any{}).
		SetEnabled(true).
		Save(ctx); err != nil {
		t.Fatalf("create enabled tool: %v", err)
	}
	disabledToolID := uuid.New()
	if _, err := client.MCPTool.Create().
		SetID(disabledToolID).
		SetUpstreamID(upstreamID).
		SetName("closed_docs").
		SetNamespacedName("platform-docs__closed_docs").
		SetScope("platform").
		SetInputSchema(map[string]any{}).
		SetEnabled(false).
		Save(ctx); err != nil {
		t.Fatalf("create disabled tool: %v", err)
	}

	disabledUpstreamID := uuid.New()
	if _, err := client.MCPUpstream.Create().
		SetID(disabledUpstreamID).
		SetName("Closed Platform Docs").
		SetSlug("closed-platform-docs").
		SetScope("platform").
		SetType("server").
		SetURL("https://closed.example.com/mcp").
		SetHeaders(map[string]string{}).
		SetEnabled(false).
		Save(ctx); err != nil {
		t.Fatalf("create disabled upstream: %v", err)
	}
	disabledUpstreamToolID := uuid.New()
	if _, err := client.MCPTool.Create().
		SetID(disabledUpstreamToolID).
		SetUpstreamID(disabledUpstreamID).
		SetName("closed_upstream_search").
		SetNamespacedName("closed-platform-docs__search_docs").
		SetScope("platform").
		SetInputSchema(map[string]any{}).
		SetEnabled(true).
		Save(ctx); err != nil {
		t.Fatalf("create disabled upstream tool: %v", err)
	}

	cfg := &config.Config{}
	cfg.Server.BaseURL = "https://monkeycode.example"
	repo := &mcpRepo{db: client, cfg: cfg}
	upstreams, err := repo.ListUserUpstreams(ctx, uid, domain.CursorReq{})
	if err != nil {
		t.Fatalf("ListUserUpstreams() error = %v", err)
	}
	if len(upstreams) == 0 {
		t.Fatal("upstreams is empty, want platform aggregate upstream")
	}

	gotTools := upstreams[0].Tools
	if len(gotTools) != 1 {
		t.Fatalf("platform tools count = %d, want 1", len(gotTools))
	}
	if gotTools[0].ID != enabledToolID {
		t.Fatalf("platform tool id = %s, want enabled tool %s and not disabled tool %s or disabled upstream tool %s", gotTools[0].ID, enabledToolID, disabledToolID, disabledUpstreamToolID)
	}
}

func TestListUserUpstreamsDefaultsUnsetPlatformToolSettingsToEnabled(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user-mcp-upstreams-tool-settings?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	uid := uuid.New()
	if _, err := client.User.Create().
		SetID(uid).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	upstreamID := uuid.New()
	if _, err := client.MCPUpstream.Create().
		SetID(upstreamID).
		SetName("Platform Docs").
		SetSlug("platform-docs").
		SetScope("platform").
		SetType("server").
		SetURL("https://example.com/mcp").
		SetHeaders(map[string]string{}).
		Save(ctx); err != nil {
		t.Fatalf("create upstream: %v", err)
	}

	closedToolID := uuid.New()
	if _, err := client.MCPTool.Create().
		SetID(closedToolID).
		SetUpstreamID(upstreamID).
		SetName("closed_docs").
		SetNamespacedName("platform-docs__closed_docs").
		SetScope("platform").
		SetInputSchema(map[string]any{}).
		SetEnabled(true).
		Save(ctx); err != nil {
		t.Fatalf("create closed tool: %v", err)
	}

	unsetToolID := uuid.New()
	if _, err := client.MCPTool.Create().
		SetID(unsetToolID).
		SetUpstreamID(upstreamID).
		SetName("search_docs").
		SetNamespacedName("platform-docs__search_docs").
		SetScope("platform").
		SetInputSchema(map[string]any{}).
		SetEnabled(true).
		Save(ctx); err != nil {
		t.Fatalf("create unset tool: %v", err)
	}

	if _, err := client.MCPUserToolSetting.Create().
		SetID(uuid.New()).
		SetUserID(uid).
		SetToolID(closedToolID).
		SetEnabled(false).
		Save(ctx); err != nil {
		t.Fatalf("create tool setting: %v", err)
	}

	cfg := &config.Config{}
	cfg.Server.BaseURL = "https://monkeycode.example"
	repo := &mcpRepo{db: client, cfg: cfg}
	upstreams, err := repo.ListUserUpstreams(ctx, uid, domain.CursorReq{})
	if err != nil {
		t.Fatalf("ListUserUpstreams() error = %v", err)
	}
	if len(upstreams) == 0 {
		t.Fatal("upstreams is empty, want platform aggregate upstream")
	}

	toolsByID := make(map[uuid.UUID]*domain.MCPTool)
	for _, tool := range upstreams[0].Tools {
		toolsByID[tool.ID] = tool
	}

	if toolsByID[closedToolID] == nil {
		t.Fatalf("closed tool %s not found", closedToolID)
	}
	if toolsByID[closedToolID].Enabled {
		t.Fatal("closed tool enabled = true, want false")
	}
	if toolsByID[unsetToolID] == nil {
		t.Fatalf("unset tool %s not found", unsetToolID)
	}
	if !toolsByID[unsetToolID].Enabled {
		t.Fatal("unset tool enabled = false, want true")
	}
}

func TestDeleteUserUpstreamMarksDeletedAt(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dsn := "file:user-mcp-upstream-delete?mode=memory&cache=shared&_fk=1"
	client := enttest.Open(t, "sqlite3", dsn)
	defer client.Close()

	sqlDB, err := sql.Open("sqlite3", dsn)
	if err != nil {
		t.Fatalf("open sql db: %v", err)
	}
	defer sqlDB.Close()

	uid := uuid.New()
	if _, err := client.User.Create().
		SetID(uid).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	upstreamID := uuid.New()
	if _, err := client.MCPUpstream.Create().
		SetID(upstreamID).
		SetName("Docs").
		SetSlug("docs").
		SetScope("user").
		SetUserID(uid).
		SetType("server").
		SetURL("https://example.com/mcp").
		SetHeaders(map[string]string{}).
		Save(ctx); err != nil {
		t.Fatalf("create upstream: %v", err)
	}

	toolID := uuid.New()
	if _, err := client.MCPTool.Create().
		SetID(toolID).
		SetUpstreamID(upstreamID).
		SetName("search_docs").
		SetNamespacedName("docs__search_docs").
		SetScope("user").
		SetUserID(uid).
		SetInputSchema(map[string]any{}).
		Save(ctx); err != nil {
		t.Fatalf("create tool: %v", err)
	}

	if _, err := client.MCPUserToolSetting.Create().
		SetID(uuid.New()).
		SetUserID(uid).
		SetToolID(toolID).
		SetEnabled(true).
		Save(ctx); err != nil {
		t.Fatalf("create tool setting: %v", err)
	}

	repo := &mcpRepo{db: client}
	if err := repo.DeleteUserUpstream(ctx, uid, upstreamID); err != nil {
		t.Fatalf("DeleteUserUpstream() error = %v", err)
	}

	var deletedAt sql.NullTime
	if err := sqlDB.QueryRowContext(ctx, "SELECT deleted_at FROM mcp_upstreams WHERE id = ?", upstreamID.String()).Scan(&deletedAt); err != nil {
		t.Fatalf("query deleted_at: %v", err)
	}
	if !deletedAt.Valid {
		t.Fatal("deleted_at is NULL, want soft-deleted upstream")
	}
}

func TestListVisibleToolsIncludesAuthorizedTeamToolsAndUsesUserSettings(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:user-mcp-visible-team-tools?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	teamID := uuid.New()
	userID := uuid.New()
	groupID := uuid.New()
	upstreamID := uuid.New()
	toolID := uuid.New()

	client.Team.Create().SetID(teamID).SetName("team").SetMemberLimit(10).SaveX(ctx)
	client.User.Create().
		SetID(userID).
		SetName("member").
		SetEmail("member@example.com").
		SetRole(consts.UserRoleSubAccount).
		SetStatus(consts.UserStatusActive).
		SaveX(ctx)
	client.TeamMember.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetUserID(userID).
		SetRole(consts.TeamMemberRoleUser).
		SaveX(ctx)
	client.TeamGroup.Create().SetID(groupID).SetTeamID(teamID).SetName("group").SaveX(ctx)
	client.TeamGroupMember.Create().SetID(uuid.New()).SetGroupID(groupID).SetUserID(userID).SaveX(ctx)
	client.MCPUpstream.Create().
		SetID(upstreamID).
		SetName("Team Docs").
		SetSlug("team-docs").
		SetScope("team").
		SetTeamID(teamID).
		SetType("server").
		SetURL("https://team.example.com/mcp").
		SetHeaders(map[string]string{}).
		SaveX(ctx)
	client.TeamGroupMCPUpstream.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetGroupID(groupID).
		SetUpstreamID(upstreamID).
		SaveX(ctx)
	client.MCPTool.Create().
		SetID(toolID).
		SetUpstreamID(upstreamID).
		SetName("search").
		SetNamespacedName("team-docs__search").
		SetScope("team").
		SetTeamID(teamID).
		SetInputSchema(map[string]any{}).
		SetEnabled(true).
		SaveX(ctx)

	repo := &mcpRepo{db: client}
	tools, err := repo.ListVisibleTools(ctx, userID)
	if err != nil {
		t.Fatalf("ListVisibleTools() error = %v", err)
	}
	if len(tools) != 1 || tools[0].ID != toolID {
		t.Fatalf("tools = %+v, want team tool %s", tools, toolID)
	}

	if err := repo.UpsertToolSetting(ctx, userID, toolID, false); err != nil {
		t.Fatalf("UpsertToolSetting() error = %v", err)
	}
	setting, err := client.MCPUserToolSetting.Query().Only(ctx)
	if err != nil {
		t.Fatalf("query user tool setting: %v", err)
	}
	if setting.UserID != userID || setting.ToolID != toolID || setting.Enabled {
		t.Fatalf("setting = %+v, want disabled user setting for team tool", setting)
	}
	tool := client.MCPTool.GetX(ctx, toolID)
	if tool.Scope != mcptool.ScopeTeam || !tool.Enabled {
		t.Fatalf("team tool mutated: scope=%s enabled=%v", tool.Scope, tool.Enabled)
	}
}
