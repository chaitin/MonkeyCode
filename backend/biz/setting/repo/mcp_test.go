package repo

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/google/uuid"
)

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
