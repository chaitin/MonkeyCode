package repo

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
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
