package v1

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestControlKeepAliveRefreshesImmediately(t *testing.T) {
	vmID := "vm-1"

	idleRefresher := &testVMIdleRefresher{ch: make(chan string, 1)}
	handler := &TaskHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: idleRefresher,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- handler.controlKeepAlive(ctx, vmID)
	}()

	select {
	case got := <-idleRefresher.ch:
		if got != vmID {
			t.Fatalf("idle refresher vm id = %q, want %q", got, vmID)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected idle refresher to run immediately")
	}

	cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("controlKeepAlive() error = nil, want context canceled")
		}
	case <-time.After(time.Second):
		t.Fatal("controlKeepAlive() did not exit after cancel")
	}
}

type testVMIdleRefresher struct {
	ch chan string
}

func (r *testVMIdleRefresher) KeepAwake(_ context.Context, vmID string) error {
	select {
	case r.ch <- vmID:
	default:
	}
	return nil
}

func (r *testVMIdleRefresher) RecordActivity(context.Context, string) error { return nil }
