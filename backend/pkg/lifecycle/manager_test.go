package lifecycle

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
)

func TestManager_Transition(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	// Clean up
	rdb.Del(context.Background(), "lifecycle:task-1")

	taskID := uuid.New()
	mgr := NewManager[uuid.UUID, TaskState, TaskMetadata](rdb, WithTransitions[uuid.UUID, TaskState, TaskMetadata](TaskTransitions()))

	ctx := context.Background()
	meta := TaskMetadata{TaskID: taskID, UserID: "user-1"}

	// Transition: pending -> running
	err := mgr.Transition(ctx, taskID, TaskStateRunning, meta)
	assert.NoError(t, err)

	state, err := mgr.GetState(ctx, taskID)
	assert.NoError(t, err)
	assert.Equal(t, TaskStateRunning, state)
}

func TestManager_InvalidTransition(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	// Clean up
	rdb.Del(context.Background(), "lifecycle:task-2")

	taskID := uuid.New()
	mgr := NewManager[uuid.UUID, TaskState, TaskMetadata](rdb, WithTransitions[uuid.UUID, TaskState, TaskMetadata](TaskTransitions()))
	ctx := context.Background()
	meta := TaskMetadata{TaskID: taskID, UserID: "user-1"}

	// First transition: (empty) -> pending
	err := mgr.Transition(ctx, taskID, TaskStatePending, meta)
	assert.NoError(t, err)

	// Transition: pending -> succeeded (invalid)
	err = mgr.Transition(ctx, taskID, TaskStateSucceeded, meta)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid transition")
}

func TestManager_HookExecution(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	// Clean up
	rdb.Del(context.Background(), "lifecycle:task-3")

	taskID := uuid.New()
	mgr := NewManager[uuid.UUID, TaskState, TaskMetadata](rdb, WithTransitions[uuid.UUID, TaskState, TaskMetadata](TaskTransitions()))

	var executed bool
	hook := &mockHook[uuid.UUID, TaskState, TaskMetadata]{
		onStateChange: func(ctx context.Context, id uuid.UUID, from, to TaskState, meta TaskMetadata) error {
			executed = true
			return nil
		},
	}
	mgr.Register(hook)

	ctx := context.Background()
	meta := TaskMetadata{TaskID: taskID, UserID: "user-1"}
	// Transition: (empty) -> running (valid)
	err := mgr.Transition(ctx, taskID, TaskStateRunning, meta)
	assert.NoError(t, err)
	assert.True(t, executed)
}

type mockHook[I comparable, S State, M any] struct {
	onStateChange func(ctx context.Context, id I, from, to S, meta M) error
}

func (h *mockHook[I, S, M]) Name() string                              { return "mock-hook" }
func (h *mockHook[I, S, M]) Priority() int                             { return 0 }
func (h *mockHook[I, S, M]) Async() bool                               { return false }
func (h *mockHook[I, S, M]) OnStateChange(ctx context.Context, id I, from, to S, meta M) error {
	return h.onStateChange(ctx, id, from, to, meta)
}
