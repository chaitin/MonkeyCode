package lifecycle

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

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
// 注意：taskLifecycle 需要在使用时已经创建完成，避免循环依赖
func NewTaskCreateHook(
	i *do.Injector,
	taskLifecycle *Manager[uuid.UUID, consts.TaskStatus, TaskMetadata],
) *TaskHook {
	return &TaskHook{
		redis:         do.MustInvoke[*redis.Client](i),
		taskflow:      do.MustInvoke[taskflow.Clienter](i),
		logger:        do.MustInvoke[*slog.Logger](i).With("hook", "task-hook"),
		taskLifecycle: taskLifecycle,
		repo:          do.MustInvoke[domain.TaskRepo](i),
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
	case consts.TaskStatusFinished:
		return h.handleFinished(ctx, id, metadata.UserID)
	}

	return nil
}

func (h *TaskHook) withError(ctx context.Context, id, uid uuid.UUID, fn func() error) {
	if err := fn(); err != nil {
		h.logger.With("error", err, "task_id", id).ErrorContext(ctx, "failed to handle processing")
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

func (h *TaskHook) handleFinished(ctx context.Context, id, uid uuid.UUID) error {
	u := domain.User{ID: uid}
	return h.repo.Update(ctx, &u, id, func(up *db.TaskUpdateOne) error {
		up.SetStatus(consts.TaskStatusFinished)
		up.SetCompletedAt(time.Now())
		return nil
	})
}

func (h *TaskHook) handleProcessing(ctx context.Context, id uuid.UUID, metadata TaskMetadata) error {
	h.withError(ctx, id, metadata.UserID, func() error {
		// 从 DB 查询当前任务状态，如果已经是 processing 说明是 Agent 重连触发的重复 vm-ready，跳过
		t, err := h.repo.GetByID(ctx, id)
		if err != nil {
			return fmt.Errorf("failed to get task: %w", err)
		}
		if t.Status == consts.TaskStatusProcessing {
			h.logger.With("task_id", id).InfoContext(ctx, "task already processing, skipping (likely agent reconnect)")
			return nil
		}

		reqKey := fmt.Sprintf("task:create_req:%s", id.String())
		val, err := h.redis.Get(ctx, reqKey).Result()
		if err != nil {
			h.logger.With("task_id", id, "error", err).ErrorContext(ctx, "failed to get CreateTaskReq from redis")
			return fmt.Errorf("failed to get CreateTaskReq from Redis: %w", err)
		}

		defer h.redis.Del(ctx, reqKey)

		if err := h.repo.Update(ctx, &domain.User{}, id, func(up *db.TaskUpdateOne) error {
			up.SetStatus(consts.TaskStatusProcessing)
			return nil
		}); err != nil {
			return fmt.Errorf("failed to update task status: %w", err)
		}

		var createReq taskflow.CreateTaskReq
		if err := json.Unmarshal([]byte(val), &createReq); err != nil {
			h.logger.With("task_id", id, "error", err).ErrorContext(ctx, "failed to unmarshal CreateTaskReq")
			return fmt.Errorf("failed to unmarshal CreateTaskReq: %w", err)
		}

		h.logger.With("task_id", id).InfoContext(ctx, "creating taskflow task")
		if err := h.taskflow.TaskManager().Create(ctx, createReq); err != nil {
			h.logger.With("error", err, "task_id", id).ErrorContext(ctx, "failed to create task")
		}
		return nil
	})

	return nil
}
