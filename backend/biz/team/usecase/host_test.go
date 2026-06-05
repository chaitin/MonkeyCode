package usecase

import (
	"context"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestTeamGetInstallCommandSkipsTLSVerification(t *testing.T) {
	t.Parallel()

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	u := &TeamHostUsecase{
		cfg: &config.Config{
			Server: struct {
				Addr    string `mapstructure:"addr"`
				BaseURL string `mapstructure:"base_url"`
			}{BaseURL: "https://monkeycode.local"},
		},
		redis: rdb,
	}

	command, err := u.GetInstallCommand(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(command, "curl -kfsSL ") {
		t.Fatalf("command should skip tls verification: %s", command)
	}
}
