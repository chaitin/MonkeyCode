package store

type RedisStore struct{}

func NewRedisStore() *RedisStore {
	return &RedisStore{}
}
