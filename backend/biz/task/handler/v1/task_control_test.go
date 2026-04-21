package v1

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/biz/task/service"
)

func TestControlKeepAliveRefreshesImmediately(t *testing.T) {
	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	vmID := "vm-1"

	idleRefresher := &testVMIdleRefresher{ch: make(chan string, 1)}
	taskActivity := &testTaskActivityRefresher{ch: make(chan uuid.UUID, 1)}
	handler := &TaskHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: idleRefresher,
		taskActivity:  taskActivity,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- handler.controlKeepAlive(ctx, taskID, vmID)
	}()

	select {
	case got := <-idleRefresher.ch:
		if got != vmID {
			t.Fatalf("idle refresher vm id = %q, want %q", got, vmID)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected idle refresher to run immediately")
	}

	select {
	case got := <-taskActivity.ch:
		if got != taskID {
			t.Fatalf("task activity task id = %s, want %s", got, taskID)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected task activity refresher to run immediately")
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

func (r *testVMIdleRefresher) Refresh(_ context.Context, vmID string) error {
	select {
	case r.ch <- vmID:
	default:
	}
	return nil
}

type testTaskActivityRefresher struct {
	ch chan uuid.UUID
}

func (r *testTaskActivityRefresher) Refresh(_ context.Context, taskID uuid.UUID) error {
	select {
	case r.ch <- taskID:
	default:
	}
	return nil
}

func (r *testTaskActivityRefresher) ForceRefresh(context.Context, uuid.UUID) error {
	return nil
}

var _ service.TaskActivityRefresher = (*testTaskActivityRefresher)(nil)
