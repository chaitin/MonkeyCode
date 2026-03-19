package lifecycle

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TaskCreateHook 在 TaskStateRunning 时从 Redis 读取 CreateTaskReq 并创建 taskflow 任务
type TaskCreateHook struct {
	redis    *redis.Client
	taskflow taskflow.Clienter
	logger   *slog.Logger
}

// NewTaskCreateHook 创建 TaskCreateHook
func NewTaskCreateHook(redis *redis.Client, taskflow taskflow.Clienter, logger *slog.Logger) *TaskCreateHook {
	return &TaskCreateHook{
		redis:    redis,
		taskflow: taskflow,
		logger:   logger.With("hook", "task-create-hook"),
	}
}

func (h *TaskCreateHook) Name() string     { return "task-create-hook" }
func (h *TaskCreateHook) Priority() int    { return 80 }
func (h *TaskCreateHook) Async() bool      { return false }

func (h *TaskCreateHook) OnStateChange(ctx context.Context, taskID uuid.UUID, from, to TaskState, metadata TaskMetadata) error {
	if to != TaskStateRunning {
		return nil
	}

	reqKey := fmt.Sprintf("task:create_req:%s", taskID.String())
	val, err := h.redis.Get(ctx, reqKey).Result()
	if err == redis.Nil {
		h.logger.WarnContext(ctx, "CreateTaskReq not found in Redis (may be expired)", "task_id", taskID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to get CreateTaskReq from Redis: %w", err)
	}

	h.redis.Del(ctx, reqKey)

	var createReq taskflow.CreateTaskReq
	if err := json.Unmarshal([]byte(val), &createReq); err != nil {
		return fmt.Errorf("failed to unmarshal CreateTaskReq: %w", err)
	}

	h.logger.InfoContext(ctx, "creating taskflow task", "task_id", taskID)
	return h.taskflow.TaskManager().Create(ctx, createReq)
}
