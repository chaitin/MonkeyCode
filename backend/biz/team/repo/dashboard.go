package repo

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"sort"
	"strconv"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/project"
	"github.com/chaitin/MonkeyCode/backend/db/projectissue"
	"github.com/chaitin/MonkeyCode/backend/db/projecttask"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmember"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/clickhouse"
)

type dashboardUsageReader interface {
	QueryModelUsageSummary(ctx context.Context, q clickhouse.ModelUsageQuery) (clickhouse.ModelUsageSummary, error)
	QueryModelUsageTopUsers(ctx context.Context, q clickhouse.ModelUsageQuery, limit int) ([]clickhouse.ModelUsageTopUser, error)
}

type dashboardConversationReader interface {
	QueryTeamConversationStats(ctx context.Context, q clickhouse.TeamConversationQuery) (clickhouse.TeamConversationStats, error)
	QueryTeamConversations(ctx context.Context, q clickhouse.TeamConversationListQuery) (*clickhouse.TeamConversationListResult, error)
}

type TeamDashboardRepo struct {
	db                 *db.Client
	usageReader        dashboardUsageReader
	conversationReader dashboardConversationReader
	logger             *slog.Logger
}

func NewTeamDashboardRepo(i *do.Injector) (domain.TeamDashboardRepo, error) {
	return &TeamDashboardRepo{
		db:                 do.MustInvoke[*db.Client](i),
		usageReader:        do.MustInvoke[*clickhouse.Client](i),
		conversationReader: do.MustInvoke[*clickhouse.Client](i),
		logger:             do.MustInvoke[*slog.Logger](i).With("module", "repo.team_dashboard"),
	}, nil
}

func (r *TeamDashboardRepo) Overview(ctx context.Context, teamID uuid.UUID, req domain.TeamDashboardQuery) (*domain.TeamDashboardResp, error) {
	memberIDs, err := r.teamMemberIDs(ctx, teamID)
	if err != nil {
		return nil, err
	}
	resp := &domain.TeamDashboardResp{}
	resp.Metrics.TotalMembers = len(memberIDs)
	if len(memberIDs) == 0 {
		trendStart := req.TrendStart
		if trendStart.IsZero() {
			trendStart = startOfDay(req.End).AddDate(0, 0, -179)
		}
		points := fillDailyPoints(trendStart, req.End, nil)
		resp.ProjectStats.DailyCreated = points
		resp.TaskStats.DailyCreated = points
		resp.ConversationStats.DailyCreated = points
		return resp, nil
	}
	if err := r.fillMetrics(ctx, resp, teamID, memberIDs, req); err != nil {
		return nil, err
	}
	if err := r.fillTrends(ctx, resp, teamID, memberIDs, req); err != nil {
		return nil, err
	}
	if err := r.fillInsights(ctx, resp, teamID, memberIDs, req); err != nil {
		return nil, err
	}
	if err := r.fillRequiredStats(ctx, resp, memberIDs, req); err != nil {
		return nil, err
	}
	return resp, nil
}

func (r *TeamDashboardRepo) teamMemberIDs(ctx context.Context, teamID uuid.UUID) ([]uuid.UUID, error) {
	return r.db.TeamMember.Query().
		Where(teammember.TeamIDEQ(teamID)).
		QueryUser().
		Where(user.IsBlockedEQ(false)).
		IDs(ctx)
}

func (r *TeamDashboardRepo) fillMetrics(ctx context.Context, resp *domain.TeamDashboardResp, teamID uuid.UUID, memberIDs []uuid.UUID, req domain.TeamDashboardQuery) error {
	taskCount, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(req.Start), task.CreatedAtLT(req.End)).
		Count(ctx)
	if err != nil {
		return err
	}
	running, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(req.Start), task.CreatedAtLT(req.End), task.StatusIn(consts.TaskStatusPending, consts.TaskStatusProcessing)).
		Count(ctx)
	if err != nil {
		return err
	}
	finished, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(req.Start), task.CreatedAtLT(req.End), task.StatusEQ(consts.TaskStatusFinished)).
		Count(ctx)
	if err != nil {
		return err
	}
	active, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...), task.LastActiveAtGTE(req.Start), task.LastActiveAtLT(req.End)).
		Unique(true).
		Select(task.FieldUserID).
		Count(ctx)
	if err != nil {
		return err
	}
	var durationRows []struct {
		AvgDuration float64 `json:"avg_duration"`
	}
	finishedTasks, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(req.Start), task.CreatedAtLT(req.End), task.StatusEQ(consts.TaskStatusFinished), task.CompletedAtNotNil()).
		All(ctx)
	if err != nil {
		return err
	}
	if len(finishedTasks) > 0 {
		var totalDuration time.Duration
		for _, tk := range finishedTasks {
			totalDuration += tk.CompletedAt.Sub(tk.CreatedAt)
		}
		durationRows = append(durationRows, struct {
			AvgDuration float64 `json:"avg_duration"`
		}{AvgDuration: totalDuration.Seconds() / float64(len(finishedTasks))})
	}
	usage, err := r.usageSummary(ctx, teamID, req.Start, req.End)
	if err != nil {
		return err
	}
	resp.Metrics.TaskCount = taskCount
	resp.Metrics.RunningTaskCount = running
	resp.Metrics.FinishedTaskCount = finished
	resp.Metrics.ActiveMembers = active
	if resp.Metrics.TotalMembers > 0 {
		resp.Metrics.ActiveRate = math.Round(float64(active)/float64(resp.Metrics.TotalMembers)*1000) / 10
	}
	if len(durationRows) > 0 {
		resp.Metrics.AverageDuration = int64(durationRows[0].AvgDuration)
	}
	resp.Metrics.InputTokens = usage.InputTokens
	resp.Metrics.OutputTokens = usage.OutputTokens
	resp.Metrics.CachedTokens = usage.CachedTokens
	resp.Metrics.TotalTokens = usage.TotalTokens
	resp.Metrics.LLMRequests = usage.Requests
	if usage.InputTokens > 0 {
		resp.Metrics.CacheHitRate = math.Round(float64(usage.CachedTokens)/float64(usage.InputTokens)*1000) / 10
	}
	return nil
}

func (r *TeamDashboardRepo) fillRequiredStats(ctx context.Context, resp *domain.TeamDashboardResp, memberIDs []uuid.UUID, req domain.TeamDashboardQuery) error {
	todayStart := startOfDay(req.End)
	start7d := todayStart.AddDate(0, 0, -6)
	trendStart := req.TrendStart
	if trendStart.IsZero() {
		trendStart = todayStart.AddDate(0, 0, -179)
	}
	projectStats, err := r.projectStats(ctx, memberIDs, start7d, todayStart, trendStart, req.End)
	if err != nil {
		return err
	}
	taskStats, err := r.taskStats(ctx, memberIDs, start7d, todayStart, trendStart, req.End)
	if err != nil {
		return err
	}
	taskIDs, err := r.teamTaskIDStrings(ctx, memberIDs)
	if err != nil {
		return err
	}
	conversationStats, err := r.conversationStats(ctx, taskIDs, start7d, todayStart, trendStart, req.End)
	if err != nil {
		return err
	}
	resp.ProjectStats = projectStats
	resp.TaskStats = taskStats
	resp.ConversationStats = conversationStats
	return nil
}

func (r *TeamDashboardRepo) projectStats(ctx context.Context, memberIDs []uuid.UUID, start7d, todayStart, trendStart, end time.Time) (domain.TeamProjectStats, error) {
	var stats domain.TeamProjectStats
	total, err := r.db.Project.Query().Where(project.UserIDIn(memberIDs...)).Count(ctx)
	if err != nil {
		return stats, err
	}
	active7d, err := r.activeProjectCount(ctx, memberIDs, start7d, end)
	if err != nil {
		return stats, err
	}
	activeToday, err := r.activeProjectCount(ctx, memberIDs, todayStart, end)
	if err != nil {
		return stats, err
	}
	daily, err := r.projectDailyCreated(ctx, memberIDs, trendStart, end)
	if err != nil {
		return stats, err
	}
	stats.Total = total
	stats.Active7d = active7d
	stats.ActiveToday = activeToday
	stats.DailyCreated = daily
	return stats, nil
}

func (r *TeamDashboardRepo) activeProjectCount(ctx context.Context, memberIDs []uuid.UUID, start, end time.Time) (int, error) {
	return r.db.Project.Query().
		Where(
			project.UserIDIn(memberIDs...),
			project.Or(
				project.And(project.UpdatedAtGTE(start), project.UpdatedAtLT(end)),
				project.HasProjectTasksWith(projecttask.HasTaskWith(task.LastActiveAtGTE(start), task.LastActiveAtLT(end))),
				project.HasIssuesWith(projectissue.UpdatedAtGTE(start), projectissue.UpdatedAtLT(end)),
			),
		).
		Count(ctx)
}

func (r *TeamDashboardRepo) projectDailyCreated(ctx context.Context, memberIDs []uuid.UUID, start, end time.Time) ([]domain.TeamDashboardTrendPoint, error) {
	rows, err := r.db.Project.Query().
		Where(project.UserIDIn(memberIDs...), project.CreatedAtGTE(start), project.CreatedAtLT(end)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, p := range rows {
		counts[p.CreatedAt.Format("2006-01-02")]++
	}
	return fillDailyPoints(start, end, counts), nil
}

func (r *TeamDashboardRepo) taskStats(ctx context.Context, memberIDs []uuid.UUID, start7d, todayStart, trendStart, end time.Time) (domain.TeamTaskStats, error) {
	var stats domain.TeamTaskStats
	total, err := r.db.Task.Query().Where(task.UserIDIn(memberIDs...)).Count(ctx)
	if err != nil {
		return stats, err
	}
	active7d, err := r.db.Task.Query().Where(task.UserIDIn(memberIDs...), task.LastActiveAtGTE(start7d), task.LastActiveAtLT(end)).Count(ctx)
	if err != nil {
		return stats, err
	}
	activeToday, err := r.db.Task.Query().Where(task.UserIDIn(memberIDs...), task.LastActiveAtGTE(todayStart), task.LastActiveAtLT(end)).Count(ctx)
	if err != nil {
		return stats, err
	}
	daily, err := r.taskDailyCreated(ctx, memberIDs, trendStart, end)
	if err != nil {
		return stats, err
	}
	stats.Total = total
	stats.Active7d = active7d
	stats.ActiveToday = activeToday
	stats.DailyCreated = daily
	return stats, nil
}

func (r *TeamDashboardRepo) taskDailyCreated(ctx context.Context, memberIDs []uuid.UUID, start, end time.Time) ([]domain.TeamDashboardTrendPoint, error) {
	rows, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(start), task.CreatedAtLT(end)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, t := range rows {
		counts[t.CreatedAt.Format("2006-01-02")]++
	}
	return fillDailyPoints(start, end, counts), nil
}

func (r *TeamDashboardRepo) conversationStats(ctx context.Context, taskIDs []string, start7d, todayStart, trendStart, end time.Time) (domain.TeamConversationStats, error) {
	var stats domain.TeamConversationStats
	if r.conversationReader == nil || len(taskIDs) == 0 {
		stats.DailyCreated = fillDailyPoints(trendStart, end, nil)
		return stats, nil
	}
	raw, err := r.conversationReader.QueryTeamConversationStats(ctx, clickhouse.TeamConversationQuery{
		TaskIDs:    taskIDs,
		Start7d:    start7d,
		TodayStart: todayStart,
		TrendStart: trendStart,
		End:        end,
	})
	if err != nil {
		return stats, err
	}
	counts := make(map[string]int64)
	for _, item := range raw.DailyCreated {
		counts[item.Date] = item.Count
	}
	stats.Total = raw.Total
	stats.Count7d = raw.Count7d
	stats.CountToday = raw.CountToday
	stats.DailyCreated = fillDailyPoints(trendStart, end, counts)
	return stats, nil
}

func (r *TeamDashboardRepo) fillTrends(ctx context.Context, resp *domain.TeamDashboardResp, teamID uuid.UUID, memberIDs []uuid.UUID, req domain.TeamDashboardQuery) error {
	days := dayKeys(req.Start, req.End)
	resp.Trends.TaskCounts = make([]domain.TeamDashboardTrendPoint, 0, len(days))
	resp.Trends.ActiveMembers = make([]domain.TeamDashboardTrendPoint, 0, len(days))
	resp.Trends.TokenUsage = make([]domain.TeamDashboardTrendPoint, 0, len(days))
	for _, day := range days {
		start := day
		end := day.AddDate(0, 0, 1)
		date := day.Format("2006-01-02")
		dayTaskIDs, err := r.db.Task.Query().
			Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(start), task.CreatedAtLT(end)).
			IDs(ctx)
		if err != nil {
			return err
		}
		active, err := r.db.Task.Query().
			Where(task.UserIDIn(memberIDs...), task.LastActiveAtGTE(start), task.LastActiveAtLT(end)).
			Unique(true).
			Select(task.FieldUserID).
			Count(ctx)
		if err != nil {
			return err
		}
		usage, err := r.usageSummary(ctx, teamID, start, end)
		if err != nil {
			return err
		}
		resp.Trends.TaskCounts = append(resp.Trends.TaskCounts, domain.TeamDashboardTrendPoint{Date: date, Value: int64(len(dayTaskIDs))})
		resp.Trends.ActiveMembers = append(resp.Trends.ActiveMembers, domain.TeamDashboardTrendPoint{Date: date, Value: int64(active)})
		resp.Trends.TokenUsage = append(resp.Trends.TokenUsage, domain.TeamDashboardTrendPoint{Date: date, Value: usage.TotalTokens})
	}
	return nil
}

func (r *TeamDashboardRepo) fillInsights(ctx context.Context, resp *domain.TeamDashboardResp, teamID uuid.UUID, memberIDs []uuid.UUID, req domain.TeamDashboardQuery) error {
	tasks, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(req.Start), task.CreatedAtLT(req.End)).
		All(ctx)
	if err != nil {
		return err
	}
	type activeItem struct {
		userID uuid.UUID
		count  int
		last   time.Time
	}
	activeByUser := make(map[uuid.UUID]*activeItem)
	for _, tk := range tasks {
		item := activeByUser[tk.UserID]
		if item == nil {
			item = &activeItem{userID: tk.UserID}
			activeByUser[tk.UserID] = item
		}
		item.count++
		if tk.LastActiveAt.After(item.last) {
			item.last = tk.LastActiveAt
		}
	}
	activeItems := make([]*activeItem, 0, len(activeByUser))
	for _, item := range activeByUser {
		activeItems = append(activeItems, item)
	}
	sort.Slice(activeItems, func(i, j int) bool {
		if activeItems[i].count == activeItems[j].count {
			return activeItems[i].last.After(activeItems[j].last)
		}
		return activeItems[i].count > activeItems[j].count
	})
	if len(activeItems) > 5 {
		activeItems = activeItems[:5]
	}
	for _, item := range activeItems {
		usr, err := r.db.User.Get(ctx, item.userID)
		if err != nil {
			return err
		}
		resp.Insights.ActiveMembers = append(resp.Insights.ActiveMembers, domain.TeamDashboardMemberInsight{
			UserID:       usr.ID,
			Name:         usr.Name,
			Email:        usr.Email,
			GroupName:    r.firstGroupName(ctx, usr.ID),
			TaskCount:    item.count,
			LastActiveAt: item.last.Unix(),
		})
	}

	usage, err := r.usageSummary(ctx, teamID, req.Start, req.End)
	if err != nil {
		return err
	}
	topUsers, err := r.topUsers(ctx, teamID, req.Start, req.End, 5)
	if err != nil {
		return err
	}
	for _, item := range topUsers {
		userID, err := uuid.Parse(item.UserID)
		if err != nil {
			continue
		}
		usr, err := r.db.User.Get(ctx, userID)
		if err != nil {
			return err
		}
		var percent float64
		if usage.TotalTokens > 0 {
			percent = math.Round(float64(item.TotalTokens)/float64(usage.TotalTokens)*1000) / 10
		}
		resp.Insights.HighConsumption = append(resp.Insights.HighConsumption, domain.TeamDashboardConsumptionInsight{
			ID:          usr.ID.String(),
			Name:        usr.Name,
			Type:        "member",
			TotalTokens: item.TotalTokens,
			LLMRequests: item.Requests,
			Percent:     percent,
		})
	}

	threshold := req.End.Add(-2 * time.Hour)
	longRunning, err := r.db.Task.Query().
		Where(
			task.UserIDIn(memberIDs...),
			task.StatusIn(consts.TaskStatusPending, consts.TaskStatusProcessing),
			task.CreatedAtLTE(threshold),
		).
		WithUser().
		WithVms(func(q *db.VirtualMachineQuery) {
			q.WithHost()
		}).
		Order(task.ByCreatedAt(sql.OrderAsc())).
		Limit(5).
		All(ctx)
	if err != nil {
		return err
	}
	for _, tk := range longRunning {
		title := tk.Title
		if title == "" {
			title = tk.Content
		}
		creator := ""
		if tk.Edges.User != nil {
			creator = tk.Edges.User.Name
		}
		hostName := ""
		if len(tk.Edges.Vms) > 0 && tk.Edges.Vms[0].Edges.Host != nil {
			host := tk.Edges.Vms[0].Edges.Host
			hostName = host.Remark
			if hostName == "" {
				hostName = host.Hostname
			}
			if hostName == "" {
				hostName = host.ID
			}
		}
		resp.Insights.LongRunningTasks = append(resp.Insights.LongRunningTasks, domain.TeamDashboardTaskInsight{
			TaskID:    tk.ID,
			Title:     title,
			Creator:   creator,
			Status:    string(tk.Status),
			Duration:  int64(req.End.Sub(tk.CreatedAt).Seconds()),
			HostName:  hostName,
			CreatedAt: tk.CreatedAt.Unix(),
		})
	}
	return nil
}

func (r *TeamDashboardRepo) usageSummary(ctx context.Context, teamID uuid.UUID, start, end time.Time) (clickhouse.ModelUsageSummary, error) {
	if r.usageReader == nil {
		return clickhouse.ModelUsageSummary{}, nil
	}
	return r.usageReader.QueryModelUsageSummary(ctx, clickhouse.ModelUsageQuery{
		TeamID: teamID.String(),
		Start:  start,
		End:    end,
	})
}

func (r *TeamDashboardRepo) topUsers(ctx context.Context, teamID uuid.UUID, start, end time.Time, limit int) ([]clickhouse.ModelUsageTopUser, error) {
	if r.usageReader == nil {
		return nil, nil
	}
	return r.usageReader.QueryModelUsageTopUsers(ctx, clickhouse.ModelUsageQuery{
		TeamID: teamID.String(),
		Start:  start,
		End:    end,
	}, limit)
}

func (r *TeamDashboardRepo) ListProjects(ctx context.Context, teamID uuid.UUID, req domain.TeamDashboardListReq) (*domain.TeamProjectListResp, error) {
	memberIDs, err := r.teamMemberIDs(ctx, teamID)
	if err != nil {
		return nil, err
	}
	resp := &domain.TeamProjectListResp{}
	if len(memberIDs) == 0 {
		return resp, nil
	}
	limit := normalizeDashboardLimit(req.Limit)
	rows, page, err := r.db.Project.Query().
		Where(project.UserIDIn(memberIDs...)).
		WithUser().
		WithIssues().
		WithProjectTasks().
		After(ctx, req.Cursor, limit)
	if err != nil {
		return nil, err
	}
	resp.Page = page
	for _, p := range rows {
		resp.Projects = append(resp.Projects, &domain.TeamProjectItem{
			ID:         p.ID,
			Name:       p.Name,
			RepoURL:    p.RepoURL,
			Branch:     p.Branch,
			Creator:    userFromDB(p.Edges.User),
			TaskCount:  len(p.Edges.ProjectTasks),
			IssueCount: len(p.Edges.Issues),
			CreatedAt:  p.CreatedAt.Unix(),
			UpdatedAt:  p.UpdatedAt.Unix(),
		})
	}
	return resp, nil
}

func (r *TeamDashboardRepo) ListTasks(ctx context.Context, teamID uuid.UUID, req domain.TeamDashboardListReq) (*domain.TeamTaskListResp, error) {
	memberIDs, err := r.teamMemberIDs(ctx, teamID)
	if err != nil {
		return nil, err
	}
	resp := &domain.TeamTaskListResp{}
	if len(memberIDs) == 0 {
		return resp, nil
	}
	rows, page, err := r.db.Task.Query().
		Where(task.UserIDIn(memberIDs...)).
		WithUser().
		WithProjectTasks(func(q *db.ProjectTaskQuery) {
			q.WithProject()
		}).
		After(ctx, req.Cursor, normalizeDashboardLimit(req.Limit))
	if err != nil {
		return nil, err
	}
	resp.Page = page
	for _, tk := range rows {
		item := &domain.TeamTaskItem{
			ID:           tk.ID,
			Title:        tk.Title,
			Content:      tk.Content,
			Status:       string(tk.Status),
			Kind:         string(tk.Kind),
			Creator:      userFromDB(tk.Edges.User),
			CreatedAt:    tk.CreatedAt.Unix(),
			LastActiveAt: tk.LastActiveAt.Unix(),
		}
		if len(tk.Edges.ProjectTasks) > 0 && tk.Edges.ProjectTasks[0].Edges.Project != nil {
			p := tk.Edges.ProjectTasks[0].Edges.Project
			item.ProjectID = p.ID
			item.ProjectName = p.Name
		}
		resp.Tasks = append(resp.Tasks, item)
	}
	return resp, nil
}

func (r *TeamDashboardRepo) ListConversations(ctx context.Context, teamID uuid.UUID, req domain.TeamDashboardListReq) (*domain.TeamConversationListResp, error) {
	memberIDs, err := r.teamMemberIDs(ctx, teamID)
	if err != nil {
		return nil, err
	}
	resp := &domain.TeamConversationListResp{}
	if len(memberIDs) == 0 || r.conversationReader == nil {
		return resp, nil
	}
	taskIDs, err := r.teamTaskIDStrings(ctx, memberIDs)
	if err != nil {
		return nil, err
	}
	raw, err := r.conversationReader.QueryTeamConversations(ctx, clickhouse.TeamConversationListQuery{
		TaskIDs: taskIDs,
		Cursor:  req.Cursor,
		Limit:   normalizeDashboardLimit(req.Limit),
	})
	if err != nil {
		return nil, err
	}
	taskUUIDs := make([]uuid.UUID, 0, len(raw.Rows))
	for _, row := range raw.Rows {
		id, err := uuid.Parse(row.TaskID)
		if err == nil {
			taskUUIDs = append(taskUUIDs, id)
		}
	}
	taskMap, err := r.taskContextMap(ctx, taskUUIDs)
	if err != nil {
		return nil, err
	}
	for _, row := range raw.Rows {
		taskID, err := uuid.Parse(row.TaskID)
		if err != nil {
			continue
		}
		payload := decodeConversationPayload(row.Data)
		item := &domain.TeamConversationItem{
			ID:              conversationID(row),
			TaskID:          taskID,
			Content:         payload.content,
			AttachmentCount: len(payload.attachments),
			CreatedAt:       row.TS.Unix(),
		}
		if ctxItem := taskMap[taskID]; ctxItem != nil {
			item.TaskTitle = ctxItem.taskTitle
			item.ProjectID = ctxItem.projectID
			item.ProjectName = ctxItem.projectName
			item.Creator = ctxItem.creator
		}
		resp.Conversations = append(resp.Conversations, item)
	}
	resp.Page = &db.Cursor{Cursor: raw.NextCursor, HasNextPage: raw.HasNextPage}
	return resp, nil
}

func (r *TeamDashboardRepo) firstGroupName(ctx context.Context, userID uuid.UUID) string {
	member, err := r.db.TeamGroupMember.Query().
		Where(teamgroupmember.UserIDEQ(userID)).
		WithGroup().
		First(ctx)
	if err != nil || member.Edges.Group == nil {
		return ""
	}
	return member.Edges.Group.Name
}

func (r *TeamDashboardRepo) teamTaskIDStrings(ctx context.Context, memberIDs []uuid.UUID) ([]string, error) {
	ids, err := r.db.Task.Query().Where(task.UserIDIn(memberIDs...)).IDs(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		result = append(result, id.String())
	}
	return result, nil
}

type taskContextItem struct {
	taskTitle   string
	projectID   uuid.UUID
	projectName string
	creator     *domain.User
}

func (r *TeamDashboardRepo) taskContextMap(ctx context.Context, taskIDs []uuid.UUID) (map[uuid.UUID]*taskContextItem, error) {
	result := make(map[uuid.UUID]*taskContextItem)
	if len(taskIDs) == 0 {
		return result, nil
	}
	rows, err := r.db.Task.Query().
		Where(task.IDIn(taskIDs...)).
		WithUser().
		WithProjectTasks(func(q *db.ProjectTaskQuery) {
			q.WithProject()
		}).
		All(ctx)
	if err != nil {
		return nil, err
	}
	for _, tk := range rows {
		item := &taskContextItem{
			taskTitle: tk.Title,
			creator:   userFromDB(tk.Edges.User),
		}
		if item.taskTitle == "" {
			item.taskTitle = tk.Content
		}
		if len(tk.Edges.ProjectTasks) > 0 && tk.Edges.ProjectTasks[0].Edges.Project != nil {
			p := tk.Edges.ProjectTasks[0].Edges.Project
			item.projectID = p.ID
			item.projectName = p.Name
		}
		result[tk.ID] = item
	}
	return result, nil
}

func dayKeys(start, end time.Time) []time.Time {
	start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
	var days []time.Time
	for d := start; d.Before(end); d = d.AddDate(0, 0, 1) {
		days = append(days, d)
	}
	return days
}

func fillDailyPoints(start, end time.Time, counts map[string]int64) []domain.TeamDashboardTrendPoint {
	days := dayKeys(start, end)
	points := make([]domain.TeamDashboardTrendPoint, 0, len(days))
	for _, day := range days {
		date := day.Format("2006-01-02")
		points = append(points, domain.TeamDashboardTrendPoint{
			Date:  date,
			Value: counts[date],
		})
	}
	return points
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func normalizeDashboardLimit(limit int) int {
	if limit <= 0 {
		return 20
	}
	if limit > 100 {
		return 100
	}
	return limit
}

func userFromDB(src *db.User) *domain.User {
	if src == nil {
		return nil
	}
	return (&domain.User{}).From(src)
}

type conversationPayload struct {
	content     string
	attachments []domain.TaskAttachment
}

func decodeConversationPayload(raw string) conversationPayload {
	var payload struct {
		Encoding    string                  `json:"encoding"`
		Content     string                  `json:"content"`
		Attachments []domain.TaskAttachment `json:"attachments"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return conversationPayload{content: raw}
	}
	if payload.Encoding == "plaintext" {
		return conversationPayload{content: payload.Content, attachments: payload.Attachments}
	}
	var legacy domain.TaskUserInputPayload
	if err := json.Unmarshal([]byte(raw), &legacy); err == nil && len(legacy.Content) > 0 {
		return conversationPayload{content: string(legacy.Content), attachments: legacy.Attachments}
	}
	return conversationPayload{content: payload.Content, attachments: payload.Attachments}
}

func conversationID(row clickhouse.TeamConversationRow) string {
	return row.TaskID + ":" + row.TS.UTC().Format(time.RFC3339Nano) + ":" + strconv.FormatUint(uint64(row.TurnSeq), 10) + ":" + strconv.FormatUint(row.MsgSeqStart, 10)
}
