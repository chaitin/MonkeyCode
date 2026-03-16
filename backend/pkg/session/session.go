package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// Session 基于 Redis Hash 的会话管理
// Hash key = {name}:{uid}，field = cookie UUID，value = JSON 数据
// 额外维护 lookup key = lookup:{name}:{cookie} → uid，用于 Get 时反查
type Session struct {
	cfg *config.Config
	rdb *redis.Client
}

func New(cfg *config.Config) *Session {
	addr := net.JoinHostPort(cfg.Redis.Host, fmt.Sprint(cfg.Redis.Port))
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: cfg.Redis.Pass,
		DB:       cfg.Redis.DB,
	})
	return &Session{cfg: cfg, rdb: rdb}
}

func (s *Session) expire() time.Duration {
	return time.Duration(s.cfg.Session.ExpireDay) * 24 * time.Hour
}

func hashKey(name string, uid uuid.UUID) string {
	return fmt.Sprintf("%s:%s", name, uid.String())
}

func lookupKey(name, cookie string) string {
	return fmt.Sprintf("lookup:%s:%s", name, cookie)
}

// Save 创建 session，内部生成 UUID cookie 并设置到 response
func (s *Session) Save(c echo.Context, name string, uid uuid.UUID, data any) (string, error) {
	ctx := c.Request().Context()
	expire := s.expire()
	cookie := uuid.NewString()

	b, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	key := hashKey(name, uid)
	pipe := s.rdb.Pipeline()
	pipe.HSet(ctx, key, cookie, string(b))
	pipe.Expire(ctx, key, expire)
	pipe.Set(ctx, lookupKey(name, cookie), uid.String(), expire)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("save session: %w", err)
	}

	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    cookie,
		Path:     "/",
		MaxAge:   int(expire.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return cookie, nil
}

// Get 从 cookie 读取 session 数据
func Get[T any](s *Session, c echo.Context, name string) (T, error) {
	var zero T
	ctx := c.Request().Context()

	ck, err := c.Cookie(name)
	if err != nil {
		return zero, err
	}

	// 通过 lookup key 反查 uid
	uid, err := s.rdb.Get(ctx, lookupKey(name, ck.Value)).Result()
	if err != nil {
		return zero, err
	}

	val, err := s.rdb.HGet(ctx, fmt.Sprintf("%s:%s", name, uid), ck.Value).Result()
	if err != nil {
		return zero, err
	}

	var t T
	if err := json.Unmarshal([]byte(val), &t); err != nil {
		return zero, err
	}
	return t, nil
}

// Del 删除单个 session（登出）
func (s *Session) Del(c echo.Context, name string, uid uuid.UUID) error {
	ctx := c.Request().Context()

	ck, err := c.Cookie(name)
	if err != nil {
		return err
	}

	key := hashKey(name, uid)
	pipe := s.rdb.Pipeline()
	pipe.HDel(ctx, key, ck.Value)
	pipe.Del(ctx, lookupKey(name, ck.Value))
	if _, err := pipe.Exec(ctx); err != nil {
		return err
	}

	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
	return nil
}

// Trunc 删除用户所有 session（踢人）
func (s *Session) Trunc(ctx context.Context, name string, uid uuid.UUID) error {
	key := hashKey(name, uid)

	// 拿到所有 cookie fields，批量删 lookup keys
	fields, err := s.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return err
	}

	if len(fields) > 0 {
		lookups := make([]string, 0, len(fields))
		for cookie := range fields {
			lookups = append(lookups, lookupKey(name, cookie))
		}
		pipe := s.rdb.Pipeline()
		pipe.Del(ctx, lookups...)
		pipe.Del(ctx, key)
		_, err = pipe.Exec(ctx)
		return err
	}

	return s.rdb.Del(ctx, key).Err()
}

// Flush 刷新用户所有 session 的数据
func (s *Session) Flush(ctx context.Context, name string, uid uuid.UUID, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}

	key := hashKey(name, uid)
	fields, err := s.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return err
	}

	if len(fields) == 0 {
		return nil
	}

	pipe := s.rdb.Pipeline()
	for cookie := range fields {
		pipe.HSet(ctx, key, cookie, string(b))
	}
	_, err = pipe.Exec(ctx)
	return err
}
