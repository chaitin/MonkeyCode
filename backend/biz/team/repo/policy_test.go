package repo

import (
	"context"
	"testing"

	"entgo.io/ent/dialect/sql/schema"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	_ "github.com/mattn/go-sqlite3"
)

func TestTeamPolicyRepoUpdateTaskVMIdlePolicyUpdatesTaskConcurrencyLimit(t *testing.T) {
	ctx := context.Background()
	client, err := db.Open("sqlite3", "file:team_policy_repo?mode=memory&cache=shared&_fk=1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Schema.Create(ctx, schema.WithForeignKeys(false)); err != nil {
		t.Fatal(err)
	}
	teamID := uuid.New()
	if _, err := client.Team.Create().
		SetID(teamID).
		SetName("研发团队").
		SetMemberLimit(10).
		Save(ctx); err != nil {
		t.Fatal(err)
	}

	r := &TeamPolicyRepo{db: client}
	got, err := r.UpdateTaskVMIdlePolicy(ctx, teamID, &domain.UpdateTeamTaskVMIdlePolicyReq{
		TaskConcurrencyLimit: 6,
		SleepEnabled:         true,
		SleepSeconds:         1200,
		RecycleEnabled:       true,
		RecycleSeconds:       7200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.TaskConcurrencyLimit != 6 {
		t.Fatalf("task concurrency limit = %d, want 6", got.TaskConcurrencyLimit)
	}
}
