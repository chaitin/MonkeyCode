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

type Session struct {
	cfg *config.Config
	rdb *redis.Client
}

func NewSession(cfg *config.Config) *Session {
	addr := net.JoinHostPort(cfg.Redis.Host, fmt.Sprint(cfg.Redis.Port))
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: cfg.Redis.Pass,
		DB:       3,
	})

	return &Session{
		cfg: cfg,
		rdb: rdb,
	}
}

func (s *Session) Save(c echo.Context, name, domain string, data any) (string, error) {
	expire := time.Duration(s.cfg.Session.ExpireDay) * 24 * time.Hour
	id := uuid.New().String()
	b, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	if ok, _ := s.rdb.SetNX(context.Background(), id, string(b), expire).Result(); !ok {
		return "", fmt.Errorf("failed to save session")
	}

	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    id,
		Path:     "/",
		Domain:   domain,
		MaxAge:   int(s.cfg.Session.ExpireDay) * 24 * 60 * 60,
		Secure:   false,
		HttpOnly: true,
	})

	return id, nil
}

func (s *Session) Del(c echo.Context, name string) error {
	ck, err := c.Cookie(name)
	if err != nil {
		return err
	}
	if err := s.rdb.Del(c.Request().Context(), ck.Value).Err(); err != nil {
		return err
	}
	ck.MaxAge = -1
	c.SetCookie(ck)
	return nil
}

func Get[T any](s *Session, c echo.Context, name string) (T, error) {
	var t T
	ck, err := c.Cookie(name)
	if err != nil {
		return t, err
	}
	ss, err := s.rdb.Get(c.Request().Context(), ck.Value).Result()
	if err != nil {
		return t, err
	}
	if err := json.Unmarshal([]byte(ss), &t); err != nil {
		return t, err
	}
	return t, err
}
