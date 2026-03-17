package delayqueue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Job 表示一个延迟任务（泛型载荷）
type Job[T any] struct {
	ID       string
	Queue    string
	Payload  T
	Attempts int
}

// Handler 处理任务（泛型载荷）
type Handler[T any] func(ctx context.Context, job *Job[T]) error

// RedisDelayQueue 基于 Redis 的延迟队列（泛型载荷）
type RedisDelayQueue[T any] struct {
	rdb          *redis.Client
	logger       *slog.Logger
	prefix       string
	pollInterval time.Duration
	batchSize    int
	requeueDelay time.Duration
	maxAttempts  int
	jobTTL       time.Duration
}

// Option 可选项（泛型载荷）
type Option[T any] func(*RedisDelayQueue[T])

const (
	defaultPrefix       = "mcai"
	defaultPollInterval = 500 * time.Millisecond
	defaultBatchSize    = 64
	defaultRequeueDelay = 5 * time.Second
	defaultMaxAttempts  = 5
	defaultJobTTL       = 7 * 24 * time.Hour
)

// NewRedisDelayQueue 创建延迟队列（泛型）
func NewRedisDelayQueue[T any](rdb *redis.Client, logger *slog.Logger, opts ...Option[T]) *RedisDelayQueue[T] {
	q := &RedisDelayQueue[T]{
		rdb:          rdb,
		logger:       logger,
		prefix:       defaultPrefix,
		pollInterval: defaultPollInterval,
		batchSize:    defaultBatchSize,
		requeueDelay: defaultRequeueDelay,
		maxAttempts:  defaultMaxAttempts,
		jobTTL:       defaultJobTTL,
	}
	for _, opt := range opts {
		opt(q)
	}
	return q
}

func WithPrefix[T any](prefix string) Option[T] {
	return func(q *RedisDelayQueue[T]) { q.prefix = prefix }
}

func WithPollInterval[T any](d time.Duration) Option[T] {
	return func(q *RedisDelayQueue[T]) { q.pollInterval = d }
}

func WithBatchSize[T any](n int) Option[T] {
	return func(q *RedisDelayQueue[T]) { q.batchSize = n }
}

func WithRequeueDelay[T any](d time.Duration) Option[T] {
	return func(q *RedisDelayQueue[T]) { q.requeueDelay = d }
}

func WithMaxAttempts[T any](n int) Option[T] {
	return func(q *RedisDelayQueue[T]) { q.maxAttempts = n }
}

func WithJobTTL[T any](d time.Duration) Option[T] {
	return func(q *RedisDelayQueue[T]) { q.jobTTL = d }
}

// Enqueue 入队（若任务不存在则写入 payload；若已存在则仅更新到期时间）
func (q *RedisDelayQueue[T]) Enqueue(ctx context.Context, queue string, payload T, runAt time.Time, id string) (string, error) {
	if id == "" {
		id = uuid.NewString()
	}

	jobKey := q.jobKey(queue, id)
	exists, err := q.rdb.Exists(ctx, jobKey).Result()
	if err != nil {
		return "", err
	}
	if exists == 0 {
		b, err := json.Marshal(&jobData[T]{Payload: payload, Attempts: 0})
		if err != nil {
			return "", err
		}
		if err := q.rdb.Set(ctx, jobKey, b, q.jobTTL).Err(); err != nil {
			return "", err
		}
	}

	zkey := q.zsetKey(queue)
	score := float64(runAt.UnixMilli())
	if err := q.rdb.ZAdd(ctx, zkey, redis.Z{Score: score, Member: id}).Err(); err != nil {
		if exists == 0 {
			_ = q.rdb.Del(ctx, jobKey).Err()
		}
		return "", err
	}
	return id, nil
}

// GetJobInfo 查询任务信息
func (q *RedisDelayQueue[T]) GetJobInfo(ctx context.Context, queue, id string) (*Job[T], time.Time, bool, error) {
	zkey := q.zsetKey(queue)
	score, err := q.rdb.ZScore(ctx, zkey, id).Result()
	if err == redis.Nil {
		return nil, time.Time{}, false, nil
	}
	if err != nil {
		return nil, time.Time{}, false, err
	}
	runAt := time.UnixMilli(int64(score))

	job, err := q.loadJob(ctx, queue, id)
	if err != nil {
		return nil, time.Time{}, false, err
	}
	if job == nil {
		return nil, time.Time{}, false, nil
	}
	return job, runAt, true, nil
}

// Remove 移除任务
func (q *RedisDelayQueue[T]) Remove(ctx context.Context, queue, id string) error {
	if err := q.rdb.ZRem(ctx, q.zsetKey(queue), id).Err(); err != nil {
		return err
	}
	return q.rdb.Del(ctx, q.jobKey(queue, id)).Err()
}

// RemoveByPrefix 批量移除匹配前缀的任务
func (q *RedisDelayQueue[T]) RemoveByPrefix(ctx context.Context, queue, prefix string) (int, error) {
	zkey := q.zsetKey(queue)
	cursor := uint64(0)
	removed := 0
	for {
		res, newCursor, err := q.rdb.ZScan(ctx, zkey, cursor, prefix+"*", 200).Result()
		if err != nil {
			return removed, err
		}
		for i := 0; i+1 < len(res); i += 2 {
			id := res[i]
			if err := q.Remove(ctx, queue, id); err != nil {
				return removed, err
			}
			removed++
		}
		cursor = newCursor
		if cursor == 0 {
			break
		}
	}
	return removed, nil
}

// StartConsumer 启动消费循环（阻塞）
func (q *RedisDelayQueue[T]) StartConsumer(ctx context.Context, queue string, handler Handler[T]) error {
	ticker := time.NewTicker(q.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := q.pollOnce(ctx, queue, handler); err != nil {
				q.logger.Warn("delayqueue poll error", "queue", queue, "err", err)
				return err
			}
		}
	}
}

func (q *RedisDelayQueue[T]) pollOnce(ctx context.Context, queue string, handler Handler[T]) error {
	ids, err := q.claimDue(ctx, queue, q.batchSize)
	if err != nil {
		return err
	}
	for _, id := range ids {
		job, err := q.loadJob(ctx, queue, id)
		if err != nil {
			q.logger.Error("load job failed", "queue", queue, "id", id, "err", err)
			continue
		}
		if job == nil {
			continue
		}
		if err := handler(ctx, job); err != nil {
			q.logger.Warn("handle job failed, will requeue", "queue", queue, "id", id, "attempts", job.Attempts+1, "err", err)
			job.Attempts++
			if job.Attempts >= q.maxAttempts {
				_ = q.deleteJob(ctx, queue, id)
				continue
			}
			if err := q.saveJob(ctx, queue, id, job.Attempts, job.Payload); err != nil {
				q.logger.Error("save job failed when requeue", "queue", queue, "id", id, "err", err)
				continue
			}
			_, _ = q.Enqueue(ctx, queue, job.Payload, time.Now().Add(q.requeueDelay), id)
			continue
		}
		if err := q.deleteJob(ctx, queue, id); err != nil {
			if ctx.Err() != nil || errors.Is(err, redis.ErrClosed) {
				q.logger.Debug("skip delete during shutdown", "queue", queue, "id", id, "err", err)
			} else {
				q.logger.Error("delete job payload failed", "queue", queue, "id", id, "err", err)
			}
		}
	}
	return nil
}

func (q *RedisDelayQueue[T]) claimDue(ctx context.Context, queue string, count int) ([]string, error) {
	zkey := q.zsetKey(queue)
	now := time.Now().UnixMilli()
	res, err := claimScript.Run(ctx, q.rdb, []string{zkey}, now, count).Result()
	if err != nil {
		return nil, err
	}
	items := make([]string, 0)
	switch v := res.(type) {
	case []any:
		for _, it := range v {
			items = append(items, fmt.Sprintf("%v", it))
		}
	case []string:
		items = append(items, v...)
	}
	return items, nil
}

func (q *RedisDelayQueue[T]) loadJob(ctx context.Context, queue, id string) (*Job[T], error) {
	jobKey := q.jobKey(queue, id)
	b, err := q.rdb.Get(ctx, jobKey).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var data jobData[T]
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	return &Job[T]{
		ID:       id,
		Queue:    queue,
		Payload:  data.Payload,
		Attempts: data.Attempts,
	}, nil
}

func (q *RedisDelayQueue[T]) saveJob(ctx context.Context, queue, id string, attempts int, payload T) error {
	jobKey := q.jobKey(queue, id)
	b, err := json.Marshal(&jobData[T]{Payload: payload, Attempts: attempts})
	if err != nil {
		return err
	}
	return q.rdb.Set(ctx, jobKey, b, q.jobTTL).Err()
}

func (q *RedisDelayQueue[T]) deleteJob(ctx context.Context, queue, id string) error {
	return q.rdb.Del(ctx, q.jobKey(queue, id)).Err()
}

// ExtendTTL 续期任务存储 TTL
func (q *RedisDelayQueue[T]) ExtendTTL(ctx context.Context, queue, id string, ttl time.Duration) error {
	return q.rdb.Expire(ctx, q.jobKey(queue, id), ttl).Err()
}

func (q *RedisDelayQueue[T]) zsetKey(queue string) string {
	return fmt.Sprintf("%s:dq:%s:delayed", q.prefix, queue)
}

func (q *RedisDelayQueue[T]) jobKey(queue, id string) string {
	return fmt.Sprintf("%s:dq:%s:job:%s", q.prefix, queue, id)
}

type jobData[T any] struct {
	Payload  T   `json:"payload"`
	Attempts int `json:"attempts"`
}

var claimScript = redis.NewScript(`
local zkey = KEYS[1]
local now = tonumber(ARGV[1])
local count = tonumber(ARGV[2])
local items = redis.call('ZRANGEBYSCORE', zkey, '-inf', now, 'LIMIT', 0, count)
if #items > 0 then
  for i=1,#items do
    redis.call('ZREM', zkey, items[i])
  end
end
return items
`)
