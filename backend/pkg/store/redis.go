package store

import (
	"context"
	"net"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func NewRedisCli(cfg *config.Config) *redis.Client {
	addr := net.JoinHostPort(cfg.Redis.Host, cfg.Redis.Port)
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     cfg.Redis.Pass,
		DB:           cfg.Redis.DB,
		MaxIdleConns: 3,
	})
	return rdb
}

type RedisResult struct {
	Key   string
	Value int64
}

func ScanRedis(ctx context.Context, rdb *redis.Client, pattern string, limit int, fn func(rs []*RedisResult) error) error {
	iter := rdb.Scan(ctx, 0, pattern, int64(limit)).Iterator()

	rs := make([]*RedisResult, 0)
	for iter.Next(ctx) {
		value, err := rdb.Get(ctx, iter.Val()).Int64()
		if err != nil {
			return err
		}
		rs = append(rs, &RedisResult{
			Key:   iter.Val(),
			Value: value,
		})

		if len(rs) >= limit {
			if err := fn(rs); err != nil {
				return err
			}
			rs = make([]*RedisResult, 0)
		}
	}

	if len(rs) > 0 {
		if err := fn(rs); err != nil {
			return err
		}
	}
	return nil
}
