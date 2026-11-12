package delayqueue

import (
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// SkillGuardQueue resumes persisted pending Skill scans after a process
// restart or after the request-side poller exits unexpectedly.
type SkillGuardQueue struct {
	*RedisDelayQueue[*domain.SkillGuardJob]
}

func NewSkillGuardQueue(rdb *redis.Client, logger *slog.Logger) *SkillGuardQueue {
	return &SkillGuardQueue{NewRedisDelayQueue(
		rdb,
		logger,
		WithPrefix[*domain.SkillGuardJob]("mcai:skillguard"),
		WithPollInterval[*domain.SkillGuardJob](time.Second),
		WithRequeueDelay[*domain.SkillGuardJob](5*time.Second),
		WithMaxAttempts[*domain.SkillGuardJob](256),
		WithJobTTL[*domain.SkillGuardJob](24*time.Hour),
	)}
}
