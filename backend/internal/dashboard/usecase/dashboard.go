package usecase

import (
	"context"
	"slices"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type DashboardUsecase struct {
	repo domain.DashboardRepo
}

func NewDashboardUsecase(repo domain.DashboardRepo) domain.DashboardUsecase {
	return &DashboardUsecase{
		repo: repo,
	}
}

func (u *DashboardUsecase) Statistics(ctx context.Context) (*domain.Statistics, error) {
	return u.repo.Statistics(ctx)
}

func (u *DashboardUsecase) CategoryStat(ctx context.Context) (*domain.CategoryStat, error) {
	return u.repo.CategoryStat(ctx)
}

func (u *DashboardUsecase) TimeStat(ctx context.Context) (*domain.TimeStat, error) {
	return u.repo.TimeStat(ctx)
}

func (u *DashboardUsecase) UserStat(ctx context.Context, username string) (*domain.UserStat, error) {
	return u.repo.UserStat(ctx, username)
}

func (u *DashboardUsecase) UserEvents(ctx context.Context, username string) ([]*domain.UserEvent, error) {
	return u.repo.UserEvents(ctx, username)
}

func (u *DashboardUsecase) UserCodeRank(ctx context.Context) ([]*domain.UserCodeRank, error) {
	return u.repo.UserCodeRank(ctx)
}

func (u *DashboardUsecase) UserHeatmap(ctx context.Context, userID string) (*domain.UserHeatmapResp, error) {
	rs, err := u.repo.UserHeatmap(ctx, userID)
	if err != nil {
		return nil, err
	}
	var count int64
	if len(rs) > 0 {
		maxCount := slices.MaxFunc(rs, func(a, b *domain.UserHeatmap) int {
			return int(a.Count - b.Count)
		})
		count = maxCount.Count
	}
	return &domain.UserHeatmapResp{
		MaxCount: count,
		Points:   rs,
	}, nil
}
