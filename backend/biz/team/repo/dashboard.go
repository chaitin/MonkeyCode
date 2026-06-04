package repo

import (
	"context"
	"log/slog"
	"math"
	"sort"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/taskusagestat"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmember"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type TeamDashboardRepo struct {
	db     *db.Client
	logger *slog.Logger
}

func NewTeamDashboardRepo(i *do.Injector) (domain.TeamDashboardRepo, error) {
	return &TeamDashboardRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.team_dashboard"),
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
		return resp, nil
	}
	if err := r.fillMetrics(ctx, resp, memberIDs, req); err != nil {
		return nil, err
	}
	if err := r.fillTrends(ctx, resp, memberIDs, req); err != nil {
		return nil, err
	}
	if err := r.fillInsights(ctx, resp, memberIDs, req); err != nil {
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

func (r *TeamDashboardRepo) fillMetrics(ctx context.Context, resp *domain.TeamDashboardResp, memberIDs []uuid.UUID, req domain.TeamDashboardQuery) error {
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
	var usageRows []struct {
		TotalTokens int64 `json:"total_tokens"`
		LLMRequests int64 `json:"llm_requests"`
	}
	if err := r.db.TaskUsageStat.Query().
		Where(taskusagestat.UserIDIn(memberIDs...), taskusagestat.CreatedAtGTE(req.Start), taskusagestat.CreatedAtLT(req.End)).
		Aggregate(
			db.As(db.Sum(taskusagestat.FieldTotalTokens), "total_tokens"),
			db.As(db.Count(), "llm_requests"),
		).
		Scan(ctx, &usageRows); err != nil {
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
	if len(usageRows) > 0 {
		resp.Metrics.TotalTokens = usageRows[0].TotalTokens
		resp.Metrics.LLMRequests = usageRows[0].LLMRequests
	}
	return nil
}

func (r *TeamDashboardRepo) fillTrends(ctx context.Context, resp *domain.TeamDashboardResp, memberIDs []uuid.UUID, req domain.TeamDashboardQuery) error {
	days := dayKeys(req.Start, req.End)
	resp.Trends.TaskCounts = make([]domain.TeamDashboardTrendPoint, 0, len(days))
	resp.Trends.ActiveMembers = make([]domain.TeamDashboardTrendPoint, 0, len(days))
	resp.Trends.TokenUsage = make([]domain.TeamDashboardTrendPoint, 0, len(days))
	for _, day := range days {
		start := day
		end := day.AddDate(0, 0, 1)
		date := day.Format("2006-01-02")
		taskCount, err := r.db.Task.Query().
			Where(task.UserIDIn(memberIDs...), task.CreatedAtGTE(start), task.CreatedAtLT(end)).
			Count(ctx)
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
		var usageRows []struct {
			TotalTokens int64 `json:"total_tokens"`
		}
		if err := r.db.TaskUsageStat.Query().
			Where(taskusagestat.UserIDIn(memberIDs...), taskusagestat.CreatedAtGTE(start), taskusagestat.CreatedAtLT(end)).
			Aggregate(db.As(db.Sum(taskusagestat.FieldTotalTokens), "total_tokens")).
			Scan(ctx, &usageRows); err != nil {
			return err
		}
		var tokens int64
		if len(usageRows) > 0 {
			tokens = usageRows[0].TotalTokens
		}
		resp.Trends.TaskCounts = append(resp.Trends.TaskCounts, domain.TeamDashboardTrendPoint{Date: date, Value: int64(taskCount)})
		resp.Trends.ActiveMembers = append(resp.Trends.ActiveMembers, domain.TeamDashboardTrendPoint{Date: date, Value: int64(active)})
		resp.Trends.TokenUsage = append(resp.Trends.TokenUsage, domain.TeamDashboardTrendPoint{Date: date, Value: tokens})
	}
	return nil
}

func (r *TeamDashboardRepo) fillInsights(ctx context.Context, resp *domain.TeamDashboardResp, memberIDs []uuid.UUID, req domain.TeamDashboardQuery) error {
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

	usageItems, err := r.db.TaskUsageStat.Query().
		Where(taskusagestat.UserIDIn(memberIDs...), taskusagestat.CreatedAtGTE(req.Start), taskusagestat.CreatedAtLT(req.End)).
		All(ctx)
	if err != nil {
		return err
	}
	type consumptionItem struct {
		userID      uuid.UUID
		totalTokens int64
		requests    int64
	}
	consumptionByUser := make(map[uuid.UUID]*consumptionItem)
	var allTokens int64
	for _, usage := range usageItems {
		item := consumptionByUser[usage.UserID]
		if item == nil {
			item = &consumptionItem{userID: usage.UserID}
			consumptionByUser[usage.UserID] = item
		}
		item.totalTokens += usage.TotalTokens
		item.requests++
		allTokens += usage.TotalTokens
	}
	consumptionItems := make([]*consumptionItem, 0, len(consumptionByUser))
	for _, item := range consumptionByUser {
		consumptionItems = append(consumptionItems, item)
	}
	sort.Slice(consumptionItems, func(i, j int) bool {
		return consumptionItems[i].totalTokens > consumptionItems[j].totalTokens
	})
	if len(consumptionItems) > 5 {
		consumptionItems = consumptionItems[:5]
	}
	for _, item := range consumptionItems {
		usr, err := r.db.User.Get(ctx, item.userID)
		if err != nil {
			return err
		}
		var percent float64
		if allTokens > 0 {
			percent = math.Round(float64(item.totalTokens)/float64(allTokens)*1000) / 10
		}
		resp.Insights.HighConsumption = append(resp.Insights.HighConsumption, domain.TeamDashboardConsumptionInsight{
			ID:          usr.ID.String(),
			Name:        usr.Name,
			Type:        "member",
			TotalTokens: item.totalTokens,
			LLMRequests: item.requests,
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

func dayKeys(start, end time.Time) []time.Time {
	start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
	var days []time.Time
	for d := start; d.Before(end); d = d.AddDate(0, 0, 1) {
		days = append(days, d)
	}
	return days
}
