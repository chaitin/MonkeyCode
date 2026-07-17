package repo

import (
	"context"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/db/enttest"
)

func TestMarkHealthStatus(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:mcphub-upstream-health?mode=memory&cache=shared&_fk=1")
	defer client.Close()
	ctx := context.Background()
	upstreamID := uuid.New()

	client.MCPUpstream.Create().
		SetID(upstreamID).
		SetName("images").
		SetSlug("images").
		SetScope("platform").
		SetType("server").
		SetURL("https://example.com/mcp").
		SaveX(ctx)

	repo := NewUpstreamRepo(client)
	if err := repo.MarkHealthStatus(ctx, upstreamID, true); err != nil {
		t.Fatal(err)
	}
	row := client.MCPUpstream.GetX(ctx, upstreamID)
	if row.HealthStatus != "healthy" || row.HealthCheckedAt == nil {
		t.Fatalf("healthy upstream = %+v", row)
	}

	if err := repo.MarkHealthStatus(ctx, upstreamID, false); err != nil {
		t.Fatal(err)
	}
	row = client.MCPUpstream.GetX(ctx, upstreamID)
	if row.HealthStatus != "unhealthy" || row.HealthCheckedAt == nil {
		t.Fatalf("unhealthy upstream = %+v", row)
	}
}
