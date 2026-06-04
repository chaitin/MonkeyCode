package modelusage

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
)

func TestBackfillWritesCachedTokensZero(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:model-usage-backfill-test?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })
	ch := &clickhouseStub{}
	now := time.Date(2026, 6, 4, 19, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	userID := uuid.New()
	taskID := uuid.New()
	projectID := uuid.New()
	usageUserID := uuid.New()

	createBackfillFixture(t, client, teamID, userID, usageUserID, taskID, projectID, now)
	err := Backfill(ctx, client, ch, BackfillOptions{
		Start:     now.Add(-time.Hour),
		End:       now.Add(time.Hour),
		BatchSize: 100,
		Logger:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatal(err)
	}
	if ch.event.Source != "backfill" {
		t.Fatalf("source = %q, want backfill", ch.event.Source)
	}
	if ch.event.CachedTokens != 0 {
		t.Fatalf("cached_tokens = %d, want 0", ch.event.CachedTokens)
	}
	if ch.event.TeamID != teamID.String() || ch.event.UserID != userID.String() || ch.event.TaskID != taskID.String() || ch.event.ProjectID != projectID.String() {
		t.Fatalf("event ids = %#v", ch.event)
	}
	if ch.event.InputTokens != 100 || ch.event.OutputTokens != 40 || ch.event.TotalTokens != 140 {
		t.Fatalf("event tokens = %#v", ch.event)
	}
}

func createBackfillFixture(t *testing.T, client *db.Client, teamID, userID, usageUserID, taskID, projectID uuid.UUID, now time.Time) {
	t.Helper()
	modelID := uuid.New()
	imageID := uuid.New()
	if _, err := client.Team.Create().SetID(teamID).SetName("研发团队").SetMemberLimit(100).Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.User.Create().SetID(userID).SetName("林航").SetEmail("lin@example.com").SetRole(consts.UserRoleEnterprise).SetStatus(consts.UserStatusActive).Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamMember.Create().SetID(uuid.New()).SetTeamID(teamID).SetUserID(userID).SetRole(consts.TeamMemberRoleUser).Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.User.Create().SetID(usageUserID).SetName("旧用户").SetEmail("old@example.com").SetRole(consts.UserRoleEnterprise).SetStatus(consts.UserStatusActive).Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Project.Create().SetID(projectID).SetUserID(userID).SetName("控制台").SetDescription("").Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Model.Create().SetID(modelID).SetUserID(userID).SetProvider("openai").SetAPIKey("key").SetBaseURL("https://example.com").SetModel("gpt-4o").Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Image.Create().SetID(imageID).SetUserID(userID).SetName("默认镜像").Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Task.Create().
		SetID(taskID).
		SetUserID(userID).
		SetKind(consts.TaskTypeDevelop).
		SetContent("统计 token").
		SetTitle("统计 token").
		SetStatus(consts.TaskStatusFinished).
		SetCreatedAt(now.Add(-30 * time.Minute)).
		SetLastActiveAt(now).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ProjectTask.Create().
		SetID(uuid.New()).
		SetTaskID(taskID).
		SetProjectID(projectID).
		SetModelID(modelID).
		SetImageID(imageID).
		SetCliName(consts.CliNameOpencode).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TaskUsageStat.Create().
		SetTaskID(taskID).
		SetUserID(usageUserID).
		SetModel("gpt-4o").
		SetInputTokens(100).
		SetOutputTokens(40).
		SetTotalTokens(140).
		SetCreatedAt(now).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
}
