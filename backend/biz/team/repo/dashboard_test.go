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
	"github.com/chaitin/MonkeyCode/backend/pkg/clickhouse"
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
	now := time.Date(2026, 6, 4, 10, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	userA := uuid.New()
	userB := uuid.New()
	taskA := uuid.New()
	taskB := uuid.New()
	repo := &TeamDashboardRepo{
		db: client,
		usageReader: &dashboardUsageReaderStub{
			summary: clickhouse.ModelUsageSummary{TotalTokens: 3000, Requests: 2},
			topUsers: []clickhouse.ModelUsageTopUser{
				{UserID: userB.String(), TotalTokens: 2000, Requests: 1},
				{UserID: userA.String(), TotalTokens: 1000, Requests: 1},
			},
		},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

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
	now := time.Date(2026, 6, 4, 10, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	userID := uuid.New()
	taskID := uuid.New()
	repo := &TeamDashboardRepo{
		db: client,
		usageReader: &dashboardUsageReaderStub{
			summary:  clickhouse.ModelUsageSummary{TotalTokens: 1200, Requests: 1},
			topUsers: []clickhouse.ModelUsageTopUser{{UserID: userID.String(), TotalTokens: 1200, Requests: 1}},
		},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

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

func TestTeamDashboardOverviewUsesClickHouseUsageSummary(t *testing.T) {
	ctx := context.Background()
	client := newDashboardRepoTestDB(t)
	ch := &dashboardUsageReaderStub{
		summary: clickhouse.ModelUsageSummary{
			InputTokens:  100,
			OutputTokens: 40,
			CachedTokens: 25,
			TotalTokens:  140,
			Requests:     2,
		},
		topUsers: []clickhouse.ModelUsageTopUser{
			{UserID: "", TotalTokens: 140, Requests: 2},
		},
	}
	repo := &TeamDashboardRepo{db: client, usageReader: ch, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	now := time.Date(2026, 6, 4, 10, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	userID := uuid.New()
	taskID := uuid.New()
	ch.topUsers[0].UserID = userID.String()

	createDashboardTeamUser(t, client, teamID, userID, "林航", "前端组")
	createDashboardTask(t, client, taskID, userID, "统计 token", consts.TaskStatusFinished, now.Add(-2*time.Hour), now.Add(-90*time.Minute), now.Add(-30*time.Minute))
	createDashboardUsage(t, client, taskID, userID, "postgres-old", 9999, now.Add(-30*time.Minute))

	resp, err := repo.Overview(ctx, teamID, domain.TeamDashboardQuery{
		Start: now.Add(-24 * time.Hour),
		End:   now,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Metrics.TotalTokens != 140 || resp.Metrics.LLMRequests != 2 {
		t.Fatalf("metrics = %#v, want clickhouse token summary", resp.Metrics)
	}
	if resp.Metrics.CachedTokens != 25 || resp.Metrics.CacheHitRate != 25 {
		t.Fatalf("cache metrics = %#v, want cached_tokens 25 and hit rate 25", resp.Metrics)
	}
	if len(resp.Insights.HighConsumption) != 1 || resp.Insights.HighConsumption[0].TotalTokens != 140 {
		t.Fatalf("high consumption = %#v, want clickhouse top user", resp.Insights.HighConsumption)
	}
}

func TestTeamDashboardOverviewIncludesProjectTaskConversationMetrics(t *testing.T) {
	ctx := context.Background()
	client := newDashboardRepoTestDB(t)
	now := time.Date(2026, 6, 5, 15, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	userID := uuid.New()
	projectID := uuid.New()
	taskID := uuid.New()
	repo := &TeamDashboardRepo{
		db:          client,
		usageReader: &dashboardUsageReaderStub{},
		conversationReader: &dashboardConversationReaderStub{
			summary: clickhouse.TeamConversationStats{
				Total:      3,
				Count7d:    2,
				CountToday: 1,
				DailyCreated: []clickhouse.TeamConversationDailyCount{
					{Date: "2026-06-05", Count: 1},
				},
			},
		},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	createDashboardTeamUser(t, client, teamID, userID, "林航", "前端组")
	createDashboardProject(t, client, projectID, userID, "控制台", now.AddDate(0, 0, -2), now.Add(-2*time.Hour))
	createDashboardTask(t, client, taskID, userID, "继续处理", consts.TaskStatusProcessing, now.Add(-3*time.Hour), now.Add(-30*time.Minute), time.Time{})
	createDashboardProjectTask(t, client, taskID, projectID, now.Add(-3*time.Hour))

	resp, err := repo.Overview(ctx, teamID, domain.TeamDashboardQuery{
		Start:      now.AddDate(0, 0, -7),
		End:        now,
		TrendStart: now.AddDate(0, 0, -179),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.ProjectStats.Total != 1 || resp.ProjectStats.Active7d != 1 || resp.ProjectStats.ActiveToday != 1 {
		t.Fatalf("project stats = %#v", resp.ProjectStats)
	}
	if resp.TaskStats.Total != 1 || resp.TaskStats.Active7d != 1 || resp.TaskStats.ActiveToday != 1 {
		t.Fatalf("task stats = %#v", resp.TaskStats)
	}
	if resp.ConversationStats.Total != 3 || resp.ConversationStats.Count7d != 2 || resp.ConversationStats.CountToday != 1 {
		t.Fatalf("conversation stats = %#v", resp.ConversationStats)
	}
}

func TestTeamDashboardListsOnlyCurrentTeamData(t *testing.T) {
	ctx := context.Background()
	client := newDashboardRepoTestDB(t)
	now := time.Date(2026, 6, 5, 15, 0, 0, 0, time.UTC)
	teamID := uuid.New()
	otherTeamID := uuid.New()
	userID := uuid.New()
	otherUserID := uuid.New()
	repo := &TeamDashboardRepo{
		db:          client,
		usageReader: &dashboardUsageReaderStub{},
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	createDashboardTeamUser(t, client, teamID, userID, "林航", "前端组")
	createDashboardTeamUser(t, client, otherTeamID, otherUserID, "周宁", "平台组")
	createDashboardProject(t, client, uuid.New(), userID, "团队项目", now, now)
	createDashboardProject(t, client, uuid.New(), otherUserID, "其他项目", now, now)

	projects, err := repo.ListProjects(ctx, teamID, domain.TeamDashboardListReq{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(projects.Projects) != 1 || projects.Projects[0].Name != "团队项目" {
		t.Fatalf("projects = %#v", projects.Projects)
	}
}

type dashboardUsageReaderStub struct {
	summary  clickhouse.ModelUsageSummary
	topUsers []clickhouse.ModelUsageTopUser
}

func (s *dashboardUsageReaderStub) QueryModelUsageSummary(ctx context.Context, q clickhouse.ModelUsageQuery) (clickhouse.ModelUsageSummary, error) {
	return s.summary, nil
}

func (s *dashboardUsageReaderStub) QueryModelUsageTopUsers(ctx context.Context, q clickhouse.ModelUsageQuery, limit int) ([]clickhouse.ModelUsageTopUser, error) {
	return s.topUsers, nil
}

type dashboardConversationReaderStub struct {
	summary clickhouse.TeamConversationStats
}

func (s *dashboardConversationReaderStub) QueryTeamConversationStats(ctx context.Context, q clickhouse.TeamConversationQuery) (clickhouse.TeamConversationStats, error) {
	return s.summary, nil
}

func (s *dashboardConversationReaderStub) QueryTeamConversations(ctx context.Context, q clickhouse.TeamConversationListQuery) (*clickhouse.TeamConversationListResult, error) {
	return &clickhouse.TeamConversationListResult{}, nil
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

func createDashboardProject(t *testing.T, client *db.Client, projectID, userID uuid.UUID, name string, createdAt, updatedAt time.Time) {
	t.Helper()
	if _, err := client.Project.Create().
		SetID(projectID).
		SetUserID(userID).
		SetName(name).
		SetRepoURL("https://example.com/" + name + ".git").
		SetCreatedAt(createdAt).
		SetUpdatedAt(updatedAt).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func createDashboardProjectTask(t *testing.T, client *db.Client, taskID, projectID uuid.UUID, createdAt time.Time) {
	t.Helper()
	userID := uuid.New()
	modelID := uuid.New()
	imageID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("资源用户").
		SetEmail(userID.String() + "@example.com").
		SetRole(consts.UserRoleEnterprise).
		SetStatus(consts.UserStatusActive).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Model.Create().
		SetID(modelID).
		SetUserID(userID).
		SetProvider("openai").
		SetAPIKey("sk-test").
		SetBaseURL("https://example.com").
		SetModel("gpt-test").
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Image.Create().
		SetID(imageID).
		SetUserID(userID).
		SetName("ubuntu").
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
		SetCreatedAt(createdAt).
		Save(context.Background()); err != nil {
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
