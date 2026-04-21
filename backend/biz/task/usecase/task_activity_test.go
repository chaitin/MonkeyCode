package usecase

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
)

func TestRefreshCreatedTaskStateAlwaysRefreshesIdleTimer(t *testing.T) {
	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	vmID := "vm-1"
	taskRefresher := &taskActivityRefresherStub{err: errors.New("db write failed")}
	idleRefresher := &vmIdleRefresherStub{}
	u := &TaskUsecase{
		logger:                slog.New(slog.NewTextHandler(io.Discard, nil)),
		taskActivityRefresher: taskRefresher,
		idleRefresher:         idleRefresher,
	}

	u.refreshCreatedTaskState(context.Background(), taskID, vmID)

	if !taskRefresher.forceCalled {
		t.Fatal("expected task activity refresher to be called")
	}
	if taskRefresher.taskID != taskID {
		t.Fatalf("task id = %s, want %s", taskRefresher.taskID, taskID)
	}
	if !idleRefresher.called {
		t.Fatal("expected vm idle refresher to be called")
	}
	if idleRefresher.vmID != vmID {
		t.Fatalf("vm id = %s, want %s", idleRefresher.vmID, vmID)
	}
}

type taskActivityRefresherStub struct {
	taskID      uuid.UUID
	forceCalled bool
	err         error
}

func (s *taskActivityRefresherStub) Refresh(context.Context, uuid.UUID) error {
	return nil
}

func (s *taskActivityRefresherStub) ForceRefresh(_ context.Context, taskID uuid.UUID) error {
	s.taskID = taskID
	s.forceCalled = true
	return s.err
}

type vmIdleRefresherStub struct {
	vmID   string
	called bool
	err    error
}

func (s *vmIdleRefresherStub) Refresh(_ context.Context, vmID string) error {
	s.vmID = vmID
	s.called = true
	return s.err
}
