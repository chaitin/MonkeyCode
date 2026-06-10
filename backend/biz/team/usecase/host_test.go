package usecase

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestGetInstallCommandStoresTokenForTwoHours(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	u := &TeamHostUsecase{
		cfg: &config.Config{
			Server: struct {
				Addr    string `mapstructure:"addr"`
				BaseURL string `mapstructure:"base_url"`
			}{BaseURL: "http://monkeycode.local"},
		},
		redis: rdb,
	}

	cmd, err := u.GetInstallCommand(ctx, &domain.TeamUser{
		User: &domain.User{ID: uuid.New(), Name: "tester"},
		Team: &domain.Team{ID: uuid.New(), Name: "team"},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := installTokenFromCommand(t, cmd)
	ttl, err := rdb.TTL(ctx, "host:token:"+token).Result()
	if err != nil {
		t.Fatal(err)
	}
	if ttl != 2*time.Hour {
		t.Fatalf("team host install token ttl = %s, want %s", ttl, 2*time.Hour)
	}
}

func installTokenFromCommand(t *testing.T, cmd string) string {
	t.Helper()

	start := strings.Index(cmd, "'")
	end := strings.LastIndex(cmd, "'")
	if start == -1 || end <= start {
		t.Fatalf("install command missing quoted url: %s", cmd)
	}
	u, err := url.Parse(cmd[start+1 : end])
	if err != nil {
		t.Fatalf("parse install command url: %v", err)
	}
	token := u.Query().Get("token")
	if token == "" {
		t.Fatalf("install command missing token: %s", cmd)
	}
	return token
}
