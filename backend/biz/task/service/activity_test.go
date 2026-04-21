package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTaskActivityRefresherRefreshUsesThrottleInterval(t *testing.T) {
	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	now := time.Unix(1_700_000_000, 0).UTC()
	repo := &taskActivityRepoStub{}
	refresher := &taskActivityRefresher{
		repo:  repo,
		clock: func() time.Time { return now },
	}

	if err := refresher.Refresh(context.Background(), taskID); err != nil {
		t.Fatalf("Refresh() error = %v", err)
	}

	if repo.taskID != taskID {
		t.Fatalf("task id = %s, want %s", repo.taskID, taskID)
	}
	if !repo.at.Equal(now) {
		t.Fatalf("refresh time = %s, want %s", repo.at, now)
	}
	if repo.minInterval != TaskActivityRefreshInterval {
		t.Fatalf("min interval = %s, want %s", repo.minInterval, TaskActivityRefreshInterval)
	}
}

func TestTaskActivityRefresherForceRefreshBypassesThrottle(t *testing.T) {
	taskID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	now := time.Unix(1_700_000_100, 0).UTC()
	repo := &taskActivityRepoStub{}
	refresher := &taskActivityRefresher{
		repo:  repo,
		clock: func() time.Time { return now },
	}

	if err := refresher.ForceRefresh(context.Background(), taskID); err != nil {
		t.Fatalf("ForceRefresh() error = %v", err)
	}

	if repo.taskID != taskID {
		t.Fatalf("task id = %s, want %s", repo.taskID, taskID)
	}
	if !repo.at.Equal(now) {
		t.Fatalf("refresh time = %s, want %s", repo.at, now)
	}
	if repo.minInterval != 0 {
		t.Fatalf("min interval = %s, want 0", repo.minInterval)
	}
}

type taskActivityRepoStub struct {
	taskID      uuid.UUID
	at          time.Time
	minInterval time.Duration
}

func (s *taskActivityRepoStub) RefreshLastActiveAt(_ context.Context, taskID uuid.UUID, at time.Time, minInterval time.Duration) error {
	s.taskID = taskID
	s.at = at
	s.minInterval = minInterval
	return nil
}
