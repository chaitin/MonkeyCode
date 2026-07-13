package delayqueue

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestGetRunAtReadsScoreWithoutPayload(t *testing.T) {
	ctx := context.Background()
	srv := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	queue := NewRedisDelayQueue[string](rdb, slog.New(slog.NewTextHandler(io.Discard, nil)), WithPrefix[string]("test"))
	runAt := time.Date(2026, 7, 13, 12, 0, 0, 123*int(time.Millisecond), time.UTC)
	if _, err := queue.Enqueue(ctx, "recycle", "payload", runAt, "vm-1"); err != nil {
		t.Fatal(err)
	}
	if err := rdb.Del(ctx, queue.jobKey("recycle", "vm-1")).Err(); err != nil {
		t.Fatal(err)
	}

	got, ok, err := queue.GetRunAt(ctx, "recycle", "vm-1")
	if err != nil || !ok {
		t.Fatalf("GetRunAt() ok = %v, err = %v", ok, err)
	}
	if !got.Equal(runAt) {
		t.Fatalf("run at = %v, want %v", got, runAt)
	}
}

func TestGetRunAtReturnsMissing(t *testing.T) {
	srv := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	queue := NewRedisDelayQueue[string](rdb, slog.Default())

	_, ok, err := queue.GetRunAt(context.Background(), "recycle", "missing")
	if err != nil || ok {
		t.Fatalf("GetRunAt() ok = %v, err = %v", ok, err)
	}
}
