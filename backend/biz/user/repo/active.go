package repo

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

// UserActiveRepo 用户活跃记录数据访问层
type UserActiveRepo struct {
	redis  *redis.Client
	logger *slog.Logger
}

// NewUserActiveRepo 创建用户活跃记录数据访问层实例
func NewUserActiveRepo(i *do.Injector) (domain.UserActiveRepo, error) {
	return &UserActiveRepo{
		redis:  do.MustInvoke[*redis.Client](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.user_active"),
	}, nil
}

// RecordActiveRecord 记录用户最后活跃时间
func (r *UserActiveRepo) RecordActiveRecord(ctx context.Context, key consts.RedisKey, field string, score time.Time) error {
	if err := r.redis.ZAdd(ctx, string(key), redis.Z{
		Score:  float64(score.Unix()),
		Member: field,
	}).Err(); err != nil {
		r.logger.ErrorContext(ctx, "failed to record user active time", "error", err, "field", field)
		return fmt.Errorf("failed to record user active time: %w", err)
	}
	return nil
}

// GetActiveRecord 获取用户最后活跃时间
func (r *UserActiveRepo) GetActiveRecord(ctx context.Context, key consts.RedisKey, userID string) (time.Time, error) {
	score, err := r.redis.ZScore(ctx, string(key), userID).Result()
	if err != nil {
		if err == redis.Nil {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	return time.Unix(int64(score), 0), nil
}
