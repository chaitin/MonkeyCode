package delayqueue

import (
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// TaskSummaryPayload 任务摘要生成的载荷
type TaskSummaryPayload struct {
	TaskID    string `json:"task_id"`
	CreatedAt int64  `json:"created_at"`
}

// TaskSummaryQueue 任务摘要生成延时队列
type TaskSummaryQueue struct {
	*RedisDelayQueue[*TaskSummaryPayload]
}

// NewTaskSummaryQueue 创建任务摘要生成延时队列
func NewTaskSummaryQueue(redis *redis.Client, logger *slog.Logger) *TaskSummaryQueue {
	queue := NewRedisDelayQueue(
		redis, logger,
		WithPrefix[*TaskSummaryPayload]("mcai:tasksummary"),
		WithPollInterval[*TaskSummaryPayload](10*time.Second),
		WithMaxAttempts[*TaskSummaryPayload](3),
		WithRequeueDelay[*TaskSummaryPayload](30*time.Second),
	)
	return &TaskSummaryQueue{queue}
}
