package delayqueue

import (
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// VMSleepQueue 空闲休眠队列
type VMSleepQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

// VMNotifyQueue 回收预警通知队列
type VMNotifyQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

// VMRecycleQueue 空闲回收队列
type VMRecycleQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

func NewVMSleepQueue(rdb *redis.Client, logger *slog.Logger) *VMSleepQueue {
	return &VMSleepQueue{NewRedisDelayQueue(rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmsleep"),
		WithPollInterval[*domain.VmIdleInfo](5*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
	)}
}

func NewVMNotifyQueue(rdb *redis.Client, logger *slog.Logger) *VMNotifyQueue {
	return &VMNotifyQueue{NewRedisDelayQueue(rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmnotify"),
		WithPollInterval[*domain.VmIdleInfo](30*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
		WithJobTTL[*domain.VmIdleInfo](8*24*time.Hour),
	)}
}

func NewVMRecycleQueue(rdb *redis.Client, logger *slog.Logger) *VMRecycleQueue {
	return &VMRecycleQueue{NewRedisDelayQueue(rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmrecycle"),
		WithPollInterval[*domain.VmIdleInfo](30*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
		WithJobTTL[*domain.VmIdleInfo](8*24*time.Hour),
	)}
}
