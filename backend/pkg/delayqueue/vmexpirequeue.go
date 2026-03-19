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

func NewVMExpireQueue(rdb *redis.Client, logger *slog.Logger) *VMExpireQueue {
	return &VMExpireQueue{NewRedisDelayQueue[*domain.VmExpireInfo](rdb, logger,
		WithPrefix[*domain.VmExpireInfo]("mcai:vmexpire"),
		WithPollInterval[*domain.VmExpireInfo](5*time.Second),
		WithRequeueDelay[*domain.VmExpireInfo](1*time.Minute),
	)}
}
