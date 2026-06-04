package repo

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func newDashboardRepoTestDB(t *testing.T) *db.Client {
	t.Helper()
	client := enttest.Open(t, "sqlite3", "file:team-dashboard-repo-test?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestTeamDashboardOverviewAggregatesMetrics(t *testing.T) {
	ctx := context.Background()
	client := newDashboardRepoTestDB(t)
	repo := &TeamDashboardRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	now := time.Date(2026, 6, 4, 10, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	userA := uuid.New()
	userB := uuid.New()
	taskA := uuid.New()
	taskB := uuid.New()

	createDashboardTeamUser(t, client, teamID, userA, "林航", "前端组")
	createDashboardTeamUser(t, client, teamID, userB, "周宁", "平台组")
	createDashboardTask(t, client, taskA, userA, "改造控制台", consts.TaskStatusFinished, now.Add(-2*time.Hour), now.Add(-70*time.Minute), now.Add(-1*time.Hour))
	createDashboardTask(t, client, taskB, userB, "排查移动端登录", consts.TaskStatusProcessing, now.Add(-3*time.Hour), now.Add(-20*time.Minute), time.Time{})
	createDashboardUsage(t, client, taskA, userA, "gpt-4o", 1000, now.Add(-90*time.Minute))
	createDashboardUsage(t, client, taskB, userB, "qwen", 2000, now.Add(-30*time.Minute))

	resp, err := repo.Overview(ctx, teamID, domain.TeamDashboardQuery{
		Start: now.Add(-24 * time.Hour),
		End:   now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Metrics.TotalMembers != 2 {
		t.Fatalf("total members = %d, want 2", resp.Metrics.TotalMembers)
	}
	if resp.Metrics.ActiveMembers != 2 {
		t.Fatalf("active members = %d, want 2", resp.Metrics.ActiveMembers)
	}
	if resp.Metrics.TaskCount != 2 || resp.Metrics.RunningTaskCount != 1 || resp.Metrics.FinishedTaskCount != 1 {
		t.Fatalf("metrics = %#v", resp.Metrics)
	}
	if resp.Metrics.AverageDuration != int64(time.Hour.Seconds()) {
		t.Fatalf("average duration = %d, want %d", resp.Metrics.AverageDuration, int64(time.Hour.Seconds()))
	}
	if resp.Metrics.TotalTokens != 3000 || resp.Metrics.LLMRequests != 2 {
		t.Fatalf("token metrics = %#v", resp.Metrics)
	}
	if len(resp.Trends.TaskCounts) != 2 {
		t.Fatalf("task trend length = %d, want 2", len(resp.Trends.TaskCounts))
	}
	if len(resp.Insights.ActiveMembers) != 2 || resp.Insights.ActiveMembers[0].TaskCount == 0 {
		t.Fatalf("active member insights = %#v", resp.Insights.ActiveMembers)
	}
	if len(resp.Insights.HighConsumption) != 2 || resp.Insights.HighConsumption[0].TotalTokens != 2000 {
		t.Fatalf("consumption insights = %#v", resp.Insights.HighConsumption)
	}
	if len(resp.Insights.LongRunningTasks) != 1 {
		t.Fatalf("long running tasks = %#v", resp.Insights.LongRunningTasks)
	}
	if resp.Insights.LongRunningTasks[0].Title != "排查移动端登录" {
		t.Fatalf("long running task title = %q", resp.Insights.LongRunningTasks[0].Title)
	}
}

func TestTeamDashboardOverviewAggregatesUsageByTask(t *testing.T) {
	ctx := context.Background()
	client := newDashboardRepoTestDB(t)
	repo := &TeamDashboardRepo{db: client, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	now := time.Date(2026, 6, 4, 10, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	userID := uuid.New()
	taskID := uuid.New()

	createDashboardTeamUser(t, client, teamID, userID, "林航", "前端组")
	createDashboardTask(t, client, taskID, userID, "统计 token", consts.TaskStatusFinished, now.Add(-2*time.Hour), now.Add(-90*time.Minute), now.Add(-30*time.Minute))
	createDashboardUsage(t, client, taskID, uuid.New(), "gpt-4o", 1200, now.Add(-48*time.Hour))

	resp, err := repo.Overview(ctx, teamID, domain.TeamDashboardQuery{
		Start: now.Add(-24 * time.Hour),
		End:   now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Metrics.TotalTokens != 1200 || resp.Metrics.LLMRequests != 1 {
		t.Fatalf("token metrics = %#v, want total_tokens 1200 and llm_requests 1", resp.Metrics)
	}
	if len(resp.Trends.TokenUsage) == 0 || resp.Trends.TokenUsage[len(resp.Trends.TokenUsage)-1].Value != 1200 {
		t.Fatalf("token trend = %#v, want last value 1200", resp.Trends.TokenUsage)
	}
	if len(resp.Insights.HighConsumption) != 1 || resp.Insights.HighConsumption[0].ID != userID.String() || resp.Insights.HighConsumption[0].TotalTokens != 1200 {
		t.Fatalf("high consumption = %#v, want task owner with 1200 tokens", resp.Insights.HighConsumption)
	}
}

func TestTeamDashboardRepoAvoidsSQLiteOnlyTimeFunction(t *testing.T) {
	content, err := os.ReadFile("dashboard.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "strftime") {
		t.Fatal("dashboard repo must not use SQLite-only strftime in shared queries")
	}
}

func createDashboardTeamUser(t *testing.T, client *db.Client, teamID, userID uuid.UUID, name, groupName string) {
	t.Helper()
	ctx := context.Background()
	exists, err := client.Team.Query().Where(team.IDEQ(teamID)).Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		if _, err := client.Team.Create().SetID(teamID).SetName("研发团队").SetMemberLimit(100).Save(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := client.User.Create().SetID(userID).SetName(name).SetEmail(name + "@example.com").SetRole(consts.UserRoleEnterprise).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamMember.Create().SetID(uuid.New()).SetTeamID(teamID).SetUserID(userID).SetRole(consts.TeamMemberRoleUser).Save(ctx); err != nil {
		t.Fatal(err)
	}
	group, err := client.TeamGroup.Create().SetID(uuid.New()).SetTeamID(teamID).SetName(groupName).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.TeamGroupMember.Create().SetID(uuid.New()).SetGroupID(group.ID).SetUserID(userID).Save(ctx); err != nil {
		t.Fatal(err)
	}
}

func createDashboardTask(t *testing.T, client *db.Client, taskID, userID uuid.UUID, title string, status consts.TaskStatus, createdAt, lastActiveAt, completedAt time.Time) {
	t.Helper()
	create := client.Task.Create().
		SetID(taskID).
		SetUserID(userID).
		SetKind(consts.TaskTypeDevelop).
		SetContent(title).
		SetTitle(title).
		SetStatus(status).
		SetCreatedAt(createdAt).
		SetLastActiveAt(lastActiveAt)
	if !completedAt.IsZero() {
		create.SetCompletedAt(completedAt)
	}
	if _, err := create.Save(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func createDashboardUsage(t *testing.T, client *db.Client, taskID, userID uuid.UUID, model string, totalTokens int64, createdAt time.Time) {
	t.Helper()
	if _, err := client.TaskUsageStat.Create().
		SetTaskID(taskID).
		SetUserID(userID).
		SetModel(model).
		SetTotalTokens(totalTokens).
		SetInputTokens(totalTokens / 2).
		SetOutputTokens(totalTokens / 2).
		SetCreatedAt(createdAt).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
}
