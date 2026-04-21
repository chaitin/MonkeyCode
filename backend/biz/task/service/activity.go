package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

const TaskActivityRefreshInterval = 5 * time.Minute

type TaskActivityRefresher interface {
	Refresh(ctx context.Context, taskID uuid.UUID) error
	ForceRefresh(ctx context.Context, taskID uuid.UUID) error
}

type taskActivityRefresher struct {
	repo  taskActivityRepo
	clock func() time.Time
}

type taskActivityRepo interface {
	RefreshLastActiveAt(ctx context.Context, id uuid.UUID, at time.Time, minInterval time.Duration) error
}

func NewTaskActivityRefresher(i *do.Injector) (TaskActivityRefresher, error) {
	return &taskActivityRefresher{
		repo:  do.MustInvoke[domain.TaskRepo](i),
		clock: time.Now,
	}, nil
}

func (r *taskActivityRefresher) Refresh(ctx context.Context, taskID uuid.UUID) error {
	return r.repo.RefreshLastActiveAt(ctx, taskID, r.clock(), TaskActivityRefreshInterval)
}

func (r *taskActivityRefresher) ForceRefresh(ctx context.Context, taskID uuid.UUID) error {
	return r.repo.RefreshLastActiveAt(ctx, taskID, r.clock(), 0)
}
