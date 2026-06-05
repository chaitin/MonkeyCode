package usecase

import (
	"context"
	"time"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type TeamDashboardUsecase struct {
	repo domain.TeamDashboardRepo
	now  func() time.Time
}

func NewTeamDashboardUsecase(i *do.Injector) (domain.TeamDashboardUsecase, error) {
	return &TeamDashboardUsecase{
		repo: do.MustInvoke[domain.TeamDashboardRepo](i),
		now:  time.Now,
	}, nil
}

func (u *TeamDashboardUsecase) Overview(ctx context.Context, teamUser *domain.TeamUser, req domain.TeamDashboardReq) (*domain.TeamDashboardResp, error) {
	now := u.now()
	start, label := dashboardRange(now, req.Range)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	resp, err := u.repo.Overview(ctx, teamUser.GetTeamID(), domain.TeamDashboardQuery{
		Start:      start,
		End:        now,
		TrendStart: todayStart.AddDate(0, 0, -179),
	})
	if err != nil {
		return nil, err
	}
	resp.Range = label
	resp.StartAt = start.Unix()
	resp.EndAt = now.Unix()
	return resp, nil
}

func (u *TeamDashboardUsecase) ListProjects(ctx context.Context, teamUser *domain.TeamUser, req domain.TeamDashboardListReq) (*domain.TeamProjectListResp, error) {
	return u.repo.ListProjects(ctx, teamUser.GetTeamID(), req)
}

func (u *TeamDashboardUsecase) ListTasks(ctx context.Context, teamUser *domain.TeamUser, req domain.TeamDashboardListReq) (*domain.TeamTaskListResp, error) {
	return u.repo.ListTasks(ctx, teamUser.GetTeamID(), req)
}

func (u *TeamDashboardUsecase) ListConversations(ctx context.Context, teamUser *domain.TeamUser, req domain.TeamDashboardListReq) (*domain.TeamConversationListResp, error) {
	return u.repo.ListConversations(ctx, teamUser.GetTeamID(), req)
}

func dashboardRange(now time.Time, value string) (time.Time, string) {
	switch value {
	case "today":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()), "today"
	case "30d":
		return now.AddDate(0, 0, -30), "30d"
	default:
		return now.AddDate(0, 0, -7), "7d"
	}
}
