package usecase

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
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
	if !idleRefresher.recordActivityCalled {
		t.Fatal("expected vm idle refresher to be called")
	}
	if idleRefresher.keepAwakeCalled {
		t.Fatal("did not expect task creation to use keep awake")
	}
	if idleRefresher.vmID != vmID {
		t.Fatalf("vm id = %s, want %s", idleRefresher.vmID, vmID)
	}
}

func TestContinueRecordsVMActivityAfterTaskflowAcceptsInput(t *testing.T) {
	manager := &continueTaskManagerStub{}
	idleRefresher := &vmIdleRefresherStub{}
	u, user, taskID, taskRefresher := newContinueTaskUsecase(t, manager, idleRefresher)
	taskRefresher.err = errors.New("db write failed")

	if err := u.Continue(context.Background(), user, taskID, domain.ContinueTaskReq{Content: []byte("继续执行")}); err != nil {
		t.Fatal(err)
	}
	if !manager.called {
		t.Fatal("expected taskflow continue to be called")
	}
	if !taskRefresher.forceCalled || taskRefresher.taskID != taskID {
		t.Fatalf("task activity called = %v, task id = %s", taskRefresher.forceCalled, taskRefresher.taskID)
	}
	if !idleRefresher.recordActivityCalled || idleRefresher.vmID != "vm-continue" {
		t.Fatalf("record activity called = %v, vm id = %q", idleRefresher.recordActivityCalled, idleRefresher.vmID)
	}
	if idleRefresher.keepAwakeCalled {
		t.Fatal("did not expect user input to use keep awake")
	}
}

func TestContinueDoesNotRecordVMActivityWhenTaskflowRejectsInput(t *testing.T) {
	wantErr := errors.New("taskflow unavailable")
	manager := &continueTaskManagerStub{err: wantErr}
	idleRefresher := &vmIdleRefresherStub{}
	u, user, taskID, taskRefresher := newContinueTaskUsecase(t, manager, idleRefresher)

	err := u.Continue(context.Background(), user, taskID, domain.ContinueTaskReq{Content: []byte("继续执行")})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Continue() error = %v, want %v", err, wantErr)
	}
	if idleRefresher.recordActivityCalled || idleRefresher.keepAwakeCalled {
		t.Fatal("did not expect rejected input to refresh vm idle state")
	}
	if taskRefresher.forceCalled {
		t.Fatal("did not expect rejected input to refresh task activity")
	}
}

func newContinueTaskUsecase(t *testing.T, manager *continueTaskManagerStub, idleRefresher *vmIdleRefresherStub) (*TaskUsecase, *domain.User, uuid.UUID, *taskActivityRefresherStub) {
	t.Helper()
	user := &domain.User{ID: uuid.New()}
	taskID := uuid.New()
	vm := &db.VirtualMachine{
		ID:            "vm-continue",
		EnvironmentID: "env-continue",
		CreatedAt:     time.Now(),
		Edges: db.VirtualMachineEdges{
			Host: &db.Host{ID: "host-continue"},
		},
	}
	repo := &continueTaskRepoStub{task: &db.Task{
		ID:        taskID,
		UserID:    user.ID,
		CreatedAt: time.Now(),
		Edges:     db.TaskEdges{Vms: []*db.VirtualMachine{vm}},
	}}
	redisClient := newTaskActivityRedis(t)
	taskRefresher := &taskActivityRefresherStub{}
	return &TaskUsecase{
		cfg:                   &config.Config{},
		repo:                  repo,
		logger:                slog.New(slog.NewTextHandler(io.Discard, nil)),
		taskflow:              &continueTaskflowStub{manager: manager},
		redis:                 redisClient,
		idleRefresher:         idleRefresher,
		taskActivityRefresher: taskRefresher,
	}, user, taskID, taskRefresher
}

func newTaskActivityRedis(t *testing.T) *redis.Client {
	t.Helper()
	srv := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return client
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
	vmID                 string
	keepAwakeCalled      bool
	recordActivityCalled bool
	err                  error
}

func (s *vmIdleRefresherStub) KeepAwake(_ context.Context, vmID string) error {
	s.vmID = vmID
	s.keepAwakeCalled = true
	return s.err
}

func (s *vmIdleRefresherStub) RecordActivity(_ context.Context, vmID string) error {
	s.vmID = vmID
	s.recordActivityCalled = true
	return s.err
}

type continueTaskRepoStub struct {
	domain.TaskRepo
	task *db.Task
}

func (s *continueTaskRepoStub) Info(context.Context, *domain.User, uuid.UUID, bool) (*db.Task, error) {
	return s.task, nil
}

type continueTaskflowStub struct {
	taskflow.Clienter
	manager taskflow.TaskManager
}

func (s *continueTaskflowStub) TaskManager() taskflow.TaskManager {
	return s.manager
}

type continueTaskManagerStub struct {
	taskflow.TaskManager
	called bool
	err    error
}

func (s *continueTaskManagerStub) Continue(context.Context, taskflow.TaskReq) error {
	s.called = true
	return s.err
}
