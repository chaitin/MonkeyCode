package delayqueue

import (
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// VMExpireQueue VM 过期队列
type VMExpireQueue struct {
	*RedisDelayQueue[*domain.VmExpireInfo]
}

// NewVMExpireQueue 创建 VM 过期队列
func NewVMExpireQueue(redis *redis.Client, logger *slog.Logger) *VMExpireQueue {
	queue := NewRedisDelayQueue(
		redis, logger,
		WithPrefix[*domain.VmExpireInfo]("mcai:vmexpire"),
		WithRequeueDelay[*domain.VmExpireInfo](1*time.Minute),
		WithPollInterval[*domain.VmExpireInfo](5*time.Second),
	)
	return &VMExpireQueue{queue}
}
