package store

import (
	"fmt"
	"net"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func NewRedisCli(cfg *config.Config) *redis.Client {
	addr := net.JoinHostPort(cfg.Redis.Host, fmt.Sprintf("%d", cfg.Redis.Port))
	rdb := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     cfg.Redis.Pass,
		DB:           cfg.Redis.DB,
		MaxIdleConns: 3,
	})
	return rdb
}
