package lifecycle

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TaskHook 用于管理任务的整个状态
type TaskHook struct {
	redis         *redis.Client
	taskflow      taskflow.Clienter
	repo          domain.TaskRepo
	logger        *slog.Logger
	taskLifecycle *Manager[uuid.UUID, consts.TaskStatus, TaskMetadata]
}

// NewTaskCreateHook 创建 TaskCreateHook
func NewTaskCreateHook(
	redis *redis.Client,
	taskflow taskflow.Clienter,
	logger *slog.Logger,
	taskLifecycle *Manager[uuid.UUID, consts.TaskStatus, TaskMetadata],
	repo domain.TaskRepo,
) *TaskHook {
	return &TaskHook{
		redis:         redis,
		taskflow:      taskflow,
		logger:        logger.With("hook", "task-hook"),
		taskLifecycle: taskLifecycle,
		repo:          repo,
	}
}

func (h *TaskHook) Name() string  { return "task-create-hook" }
func (h *TaskHook) Priority() int { return 80 }
func (h *TaskHook) Async() bool   { return false }

func (h *TaskHook) OnStateChange(ctx context.Context, id uuid.UUID, from, to consts.TaskStatus, metadata TaskMetadata) error {

	switch to {
	case consts.TaskStatusProcessing:
		return h.handleProcessing(ctx, id, metadata)
	case consts.TaskStatusError:
		return h.handleError(ctx, id, metadata.UserID)
	}

	return nil
}

func (h *TaskHook) withError(ctx context.Context, id, uid uuid.UUID, fn func() error) {
	if err := fn(); err != nil {
		if err := h.taskLifecycle.Transition(ctx, id, consts.TaskStatusError, TaskMetadata{
			TaskID: id,
			UserID: uid,
			Error:  err.Error(),
		}); err != nil {
			h.logger.With("error", err).ErrorContext(ctx, "failed to transition task to error status")
		}
	}
}

func (h *TaskHook) handleError(ctx context.Context, id, uid uuid.UUID) error {
	u := domain.User{ID: uid}
	return h.repo.Update(ctx, &u, id, func(up *db.TaskUpdateOne) error {
		up.SetStatus(consts.TaskStatusError)
		return nil
	})
}

func (h *TaskHook) handleProcessing(ctx context.Context, id uuid.UUID, metadata TaskMetadata) error {
	h.withError(ctx, id, metadata.UserID, func() error {
		reqKey := fmt.Sprintf("task:create_req:%s", id.String())
		val, err := h.redis.Get(ctx, reqKey).Result()
		if err != nil {
			h.logger.With("task_id", id, "error", err).ErrorContext(ctx, "failed to get CreateTaskReq from redis")
			return fmt.Errorf("failed to get CreateTaskReq from Redis: %w", err)
		}

		defer h.redis.Del(ctx, reqKey)

		var createReq taskflow.CreateTaskReq
		if err := json.Unmarshal([]byte(val), &createReq); err != nil {
			h.logger.With("task_id", id, "error", err).ErrorContext(ctx, "failed to unmarshal CreateTaskReq")
			return fmt.Errorf("failed to unmarshal CreateTaskReq: %w", err)
		}

		h.logger.With("task_id", id).InfoContext(ctx, "creating taskflow task")
		return h.taskflow.TaskManager().Create(ctx, createReq)
	})

	return nil
}
