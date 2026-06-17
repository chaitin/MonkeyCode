package registry

import (
	"context"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
)

func TestListEffectiveToolsIncludesOnlyAuthorizedTeamGroupTools(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:mcphub-registry-team?mode=memory&cache=shared&_fk=1")
	defer client.Close()
	ctx := context.Background()

	teamID := uuid.New()
	userID := uuid.New()
	groupID := uuid.New()
	allowedUpstreamID := uuid.New()
	blockedUpstreamID := uuid.New()

	client.Team.Create().SetID(teamID).SetName("team").SetMemberLimit(10).SaveX(ctx)
	client.User.Create().
		SetID(userID).
		SetName("u").
		SetEmail("u@example.com").
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
		SetID(allowedUpstreamID).
		SetName("allowed").
		SetSlug("allowed").
		SetScope("team").
		SetTeamID(teamID).
		SetType("server").
		SetURL("https://allowed.example/mcp").
		SaveX(ctx)
	client.MCPUpstream.Create().
		SetID(blockedUpstreamID).
		SetName("blocked").
		SetSlug("blocked").
		SetScope("team").
		SetTeamID(teamID).
		SetType("server").
		SetURL("https://blocked.example/mcp").
		SaveX(ctx)
	client.TeamGroupMCPUpstream.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetGroupID(groupID).
		SetUpstreamID(allowedUpstreamID).
		SaveX(ctx)
	client.MCPTool.Create().
		SetID(uuid.New()).
		SetUpstreamID(allowedUpstreamID).
		SetName("search").
		SetNamespacedName("allowed.search").
		SetScope("team").
		SetTeamID(teamID).
		SaveX(ctx)
	client.MCPTool.Create().
		SetID(uuid.New()).
		SetUpstreamID(blockedUpstreamID).
		SetName("secret").
		SetNamespacedName("blocked.secret").
		SetScope("team").
		SetTeamID(teamID).
		SaveX(ctx)

	svc := NewService(nil, repo.NewToolRepo(client), repo.NewUserToolSettingRepo(client))
	tools, err := svc.ListEffectiveTools(ctx, userID)
	if err != nil {
		t.Fatalf("ListEffectiveTools() error = %v", err)
	}
	if len(tools) != 1 || tools[0].NamespacedName != "allowed.search" {
		t.Fatalf("tools = %+v, want only allowed.search", tools)
	}
}
