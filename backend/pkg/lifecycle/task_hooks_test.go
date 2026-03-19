package lifecycle

import (
	"context"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestTaskNotifyHook_OnStateChange(t *testing.T) {
	t.Parallel()

	mockNotify := &mockNotifyPublisher{}
	logger := slog.Default()
	hook := NewTaskNotifyHook(mockNotify, logger)

	ctx := context.Background()
	taskID := uuid.New()
	meta := TaskMetadata{TaskID: taskID, UserID: uuid.New().String()}

	t.Run("Pending state triggers TaskCreated event", func(t *testing.T) {
		mockNotify.events = nil
		err := hook.OnStateChange(ctx, taskID, "", TaskStatePending, meta)
		assert.NoError(t, err)
		assert.Len(t, mockNotify.events, 1)
		assert.Equal(t, consts.NotifyEventTaskCreated, mockNotify.events[0].EventType)
		assert.Equal(t, taskID.String(), mockNotify.events[0].RefID)
	})

	t.Run("Running state triggers TaskStarted event", func(t *testing.T) {
		mockNotify.events = nil
		err := hook.OnStateChange(ctx, taskID, TaskStatePending, TaskStateRunning, meta)
		assert.NoError(t, err)
		assert.Len(t, mockNotify.events, 1)
		assert.Equal(t, consts.NotifyEventTaskStarted, mockNotify.events[0].EventType)
	})

	t.Run("Succeeded state triggers TaskCompleted event", func(t *testing.T) {
		mockNotify.events = nil
		err := hook.OnStateChange(ctx, taskID, TaskStateRunning, TaskStateSucceeded, meta)
		assert.NoError(t, err)
		assert.Len(t, mockNotify.events, 1)
		assert.Equal(t, consts.NotifyEventTaskCompleted, mockNotify.events[0].EventType)
	})

	t.Run("Failed state triggers TaskFailed event", func(t *testing.T) {
		mockNotify.events = nil
		err := hook.OnStateChange(ctx, taskID, TaskStateRunning, TaskStateFailed, meta)
		assert.NoError(t, err)
		assert.Len(t, mockNotify.events, 1)
		assert.Equal(t, consts.NotifyEventTaskFailed, mockNotify.events[0].EventType)
	})

	t.Run("Unknown state returns nil without publishing event", func(t *testing.T) {
		mockNotify.events = nil
		err := hook.OnStateChange(ctx, taskID, TaskStatePending, TaskState(""), meta)
		assert.NoError(t, err)
		assert.Len(t, mockNotify.events, 0)
	})
}

func TestTaskNotifyHook_Name(t *testing.T) {
	t.Parallel()

	logger := slog.Default()
	hook := NewTaskNotifyHook(nil, logger)
	assert.Equal(t, "task-notify-hook", hook.Name())
}

func TestTaskNotifyHook_Priority(t *testing.T) {
	t.Parallel()

	logger := slog.Default()
	hook := NewTaskNotifyHook(nil, logger)
	assert.Equal(t, 50, hook.Priority())
}

func TestTaskNotifyHook_Async(t *testing.T) {
	t.Parallel()

	logger := slog.Default()
	hook := NewTaskNotifyHook(nil, logger)
	assert.True(t, hook.Async())
}

type mockNotifyPublisher struct {
	events []*domain.NotifyEvent
}

func (m *mockNotifyPublisher) Publish(ctx context.Context, event *domain.NotifyEvent) error {
	m.events = append(m.events, event)
	return nil
}
