package delayqueue

import (
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// VMSleepQueue 10 分钟空闲休眠队列
type VMSleepQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

// VMNotifyQueue 回收预警通知队列
type VMNotifyQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

// VMRecycleQueue 7 天空闲回收队列
type VMRecycleQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

func NewVMSleepQueue(rdb *redis.Client, logger *slog.Logger) *VMSleepQueue {
	return &VMSleepQueue{NewRedisDelayQueue[*domain.VmIdleInfo](rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmsleep"),
		WithPollInterval[*domain.VmIdleInfo](5*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
	)}
}

func NewVMNotifyQueue(rdb *redis.Client, logger *slog.Logger) *VMNotifyQueue {
	return &VMNotifyQueue{NewRedisDelayQueue[*domain.VmIdleInfo](rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmnotify"),
		WithPollInterval[*domain.VmIdleInfo](30*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
		WithJobTTL[*domain.VmIdleInfo](8*24*time.Hour),
	)}
}

func NewVMRecycleQueue(rdb *redis.Client, logger *slog.Logger) *VMRecycleQueue {
	return &VMRecycleQueue{NewRedisDelayQueue[*domain.VmIdleInfo](rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmrecycle"),
		WithPollInterval[*domain.VmIdleInfo](30*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
		WithJobTTL[*domain.VmIdleInfo](8*24*time.Hour),
	)}
}
