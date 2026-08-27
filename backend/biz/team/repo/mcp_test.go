package repo

import (
	"context"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestTeamMCPUpdatePreservesMaskedHeaderValues(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	createTeamRepoDefaultGroup(t, client, teamID)
	repo := &teamMCPRepo{db: client}

	upstream, err := repo.CreateUpstream(ctx, teamID, &domain.CreateTeamMCPUpstreamReq{
		Name: "private-mcp",
		Slug: "private-mcp",
		URL:  "https://mcp.example.com/mcp",
		Headers: []domain.MCPHeader{
			{Name: "Authorization", Value: "Bearer secret"},
			{Name: "X-API-Key", Value: "api secret"},
			{Name: "X-Trace", Value: "old trace"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	headers := []domain.MCPHeader{
		{Name: "authorization", Value: domain.MCPHeaderMask},
		{Name: "X-API-Key", Value: domain.MCPHeaderMask},
		{Name: "X-Trace", Value: "new trace"},
	}
	updated, err := repo.UpdateUpstream(ctx, teamID, &domain.UpdateTeamMCPUpstreamReq{
		UpstreamID: upstream.ID,
		Headers:    &headers,
	})
	if err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"authorization": "Bearer secret",
		"X-API-Key":     "api secret",
		"X-Trace":       "new trace",
	}
	if len(updated.Headers) != len(want) {
		t.Fatalf("headers = %#v, want %#v", updated.Headers, want)
	}
	for name, value := range want {
		if updated.Headers[name] != value {
			t.Fatalf("header %s = %q, want %q", name, updated.Headers[name], value)
		}
	}
}
