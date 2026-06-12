package tasklog_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/tasklog"
)

func TestLokiProviderQueryTurnsForwardUnsupported(t *testing.T) {
	provider := tasklog.NewLokiProvider(nil)

	_, err := provider.QueryTurns(context.Background(), uuid.New(), time.Now(), tasklog.QueryTurnsOpts{
		Cursor:    "1710000000000000000",
		Limit:     2,
		Direction: tasklog.DirectionForward,
	})
	if !errors.Is(err, tasklog.ErrDirectionUnsupported) {
		t.Fatalf("expected ErrDirectionUnsupported, got: %v", err)
	}
}

func TestLokiProviderQueryTurnsInclusiveUnsupported(t *testing.T) {
	provider := tasklog.NewLokiProvider(nil)

	_, err := provider.QueryTurns(context.Background(), uuid.New(), time.Now(), tasklog.QueryTurnsOpts{
		Cursor:    "1710000000000000000",
		Limit:     2,
		Inclusive: true,
	})
	if !errors.Is(err, tasklog.ErrDirectionUnsupported) {
		t.Fatalf("expected ErrDirectionUnsupported, got: %v", err)
	}
}

func TestLokiProviderQueryTurnsInclusiveWithoutCursorIsNoop(t *testing.T) {
	provider := tasklog.NewLokiProvider(nil)

	// 无 cursor 时 inclusive 是 no-op，不应被方向检查拒绝；
	// nil client 下走到 ErrProviderUnavailable 即说明通过了方向检查。
	_, err := provider.QueryTurns(context.Background(), uuid.New(), time.Now(), tasklog.QueryTurnsOpts{
		Limit:     2,
		Inclusive: true,
	})
	if !errors.Is(err, tasklog.ErrProviderUnavailable) {
		t.Fatalf("expected ErrProviderUnavailable, got: %v", err)
	}
}
