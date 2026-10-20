package repo

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestTeamModelUpdateReturnsModel(t *testing.T) {
	for _, name := range []string{"omitted_groups", "empty_groups", "replace_groups"} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			client := newTeamRepoTestDB(t)
			teamID := createTeamRepoTestTeam(t, client)
			userID := createTeamRepoTestUser(t, client)
			group := createTeamRepoDefaultGroup(t, client, teamID)
			repo := &teamModelRepo{db: client}
			model, err := repo.Create(ctx, teamID, userID, &domain.AddTeamModelReq{
				Provider:      "openai",
				APIKey:        "old-key",
				BaseURL:       "https://example.com/v1",
				Model:         "old-model",
				InterfaceType: consts.InterfaceTypeOpenAIChat,
			})
			if err != nil {
				t.Fatal(err)
			}

			req := &domain.UpdateTeamModelReq{
				ModelID: model.ID,
				APIKey:  "updated-key",
				Model:   "updated-model",
			}
			wantGroupID := group.ID
			switch name {
			case "empty_groups":
				req.GroupIDs = []uuid.UUID{}
			case "replace_groups":
				wantGroupID = createTeamRepoGroup(t, client, teamID, "模型分组").ID
				req.GroupIDs = []uuid.UUID{wantGroupID}
			}

			got, err := repo.Update(ctx, teamID, req)
			if err != nil {
				t.Fatalf("Update() error = %v", err)
			}
			if got == nil {
				t.Fatal("Update() returned nil model without error")
			}
			if got.ID != model.ID || got.Model != req.Model || got.APIKey != req.APIKey {
				t.Fatalf("Update() returned unexpected model fields: id=%s model=%s", got.ID, got.Model)
			}
			if len(got.Edges.Groups) != 1 || got.Edges.Groups[0].ID != wantGroupID {
				t.Fatalf("Update() returned unexpected groups: %v", got.Edges.Groups)
			}

			stored, err := client.Model.Get(ctx, model.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Model != req.Model || stored.APIKey != req.APIKey {
				t.Fatal("updated model fields were not persisted")
			}
			if !teamRepoModelInGroup(t, client, wantGroupID, model.ID) {
				t.Fatal("expected group association was not persisted")
			}
			if name == "replace_groups" && teamRepoModelInGroup(t, client, group.ID, model.ID) {
				t.Fatal("old group association was not removed")
			}
		})
	}
}
