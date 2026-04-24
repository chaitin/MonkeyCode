package lifecycle

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestManagerTransitionContinuesAfterHookError(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	mgr := NewManager[string, VMState, VMMetadata](
		rdb,
		WithLogger[string, VMState, VMMetadata](slog.New(slog.NewTextHandler(io.Discard, nil))),
		WithTransitions[string, VMState, VMMetadata](VMTransitions()),
	)
	second := &recordHook{}
	mgr.Register(&errorHook{}, second)

	err = mgr.Transition(context.Background(), "vm-1", VMStateRecycled, VMMetadata{VMID: "vm-1"})
	if err == nil {
		t.Fatal("expected Transition() to return hook error")
	}
	if !second.called {
		t.Fatal("expected later hook to run after earlier hook error")
	}
}

type errorHook struct{}

func (h *errorHook) Name() string  { return "error-hook" }
func (h *errorHook) Priority() int { return 100 }
func (h *errorHook) Async() bool   { return false }
func (h *errorHook) OnStateChange(context.Context, string, VMState, VMState, VMMetadata) error {
	return errors.New("boom")
}

type recordHook struct {
	called bool
}

func (h *recordHook) Name() string  { return "record-hook" }
func (h *recordHook) Priority() int { return 90 }
func (h *recordHook) Async() bool   { return false }
func (h *recordHook) OnStateChange(context.Context, string, VMState, VMState, VMMetadata) error {
	h.called = true
	return nil
}
