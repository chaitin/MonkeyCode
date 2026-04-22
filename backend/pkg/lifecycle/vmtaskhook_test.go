package lifecycle

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

func TestVMTaskHook_OnStateChange_FailedTransitionsTaskToError(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	taskLifecycle := NewManager[uuid.UUID, consts.TaskStatus, TaskMetadata](
		rdb,
		WithLogger[uuid.UUID, consts.TaskStatus, TaskMetadata](slog.New(slog.NewTextHandler(io.Discard, nil))),
		WithTransitions[uuid.UUID, consts.TaskStatus, TaskMetadata](TaskTransitions()),
	)

	taskID := uuid.New()
	userID := uuid.New()
	meta := TaskMetadata{TaskID: taskID, UserID: userID}
	if err := taskLifecycle.Transition(context.Background(), taskID, consts.TaskStatusPending, meta); err != nil {
		t.Fatalf("taskLifecycle.Transition(pending) error = %v", err)
	}

	hook := &VMTaskHook{
		taskLifecycle: taskLifecycle,
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if err := hook.OnStateChange(context.Background(), "vm-1", VMStatePending, VMStateFailed, VMMetadata{
		VMID:   "vm-1",
		TaskID: &taskID,
		UserID: userID,
	}); err != nil {
		t.Fatalf("OnStateChange() error = %v", err)
	}

	state, err := taskLifecycle.GetState(context.Background(), taskID)
	if err != nil {
		t.Fatalf("taskLifecycle.GetState() error = %v", err)
	}
	if state != consts.TaskStatusError {
		t.Fatalf("task state = %s, want %s", state, consts.TaskStatusError)
	}
}

func TestVMTaskHook_OnStateChange_RecycledTransitionsTaskToFinished(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	taskLifecycle := NewManager[uuid.UUID, consts.TaskStatus, TaskMetadata](
		rdb,
		WithLogger[uuid.UUID, consts.TaskStatus, TaskMetadata](slog.New(slog.NewTextHandler(io.Discard, nil))),
		WithTransitions[uuid.UUID, consts.TaskStatus, TaskMetadata](TaskTransitions()),
	)

	taskID := uuid.New()
	userID := uuid.New()
	meta := TaskMetadata{TaskID: taskID, UserID: userID}
	if err := taskLifecycle.Transition(context.Background(), taskID, consts.TaskStatusPending, meta); err != nil {
		t.Fatalf("taskLifecycle.Transition(pending) error = %v", err)
	}
	if err := taskLifecycle.Transition(context.Background(), taskID, consts.TaskStatusProcessing, meta); err != nil {
		t.Fatalf("taskLifecycle.Transition(processing) error = %v", err)
	}

	hook := &VMTaskHook{
		taskLifecycle: taskLifecycle,
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if err := hook.OnStateChange(context.Background(), "vm-1", VMStateRunning, VMStateRecycled, VMMetadata{
		VMID:   "vm-1",
		TaskID: &taskID,
		UserID: userID,
	}); err != nil {
		t.Fatalf("OnStateChange() error = %v", err)
	}

	state, err := taskLifecycle.GetState(context.Background(), taskID)
	if err != nil {
		t.Fatalf("taskLifecycle.GetState() error = %v", err)
	}
	if state != consts.TaskStatusFinished {
		t.Fatalf("task state = %s, want %s", state, consts.TaskStatusFinished)
	}
}
