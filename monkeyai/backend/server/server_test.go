package server

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRunRequiresLoggerAndInstallsExactRootBeforeConfig(t *testing.T) {
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	if err := Run(context.Background(), nil, nil, nil); err == nil {
		t.Fatal("nil logger accepted")
	}
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	if err := Run(context.Background(), nil, logger, nil); err == nil {
		t.Fatal("nil factory accepted")
	}
	if slog.Default() != logger {
		t.Fatal("root logger was not retained")
	}
	t.Setenv("MONKEYAI_DATABASE_URL", "")
	called := false
	factory := func(*pgxpool.Pool) (member.UserWriter, member.GroupWriter, error) {
		called = true
		return nil, nil, nil
	}
	if err := Run(t.Context(), nil, logger, factory); err == nil || called {
		t.Fatal("invalid config did not fail before the member factory")
	}
	if slog.Default() != logger {
		t.Fatal("config failure replaced or restored the root logger")
	}
	logger.Info("caller still owns the logger")
}
