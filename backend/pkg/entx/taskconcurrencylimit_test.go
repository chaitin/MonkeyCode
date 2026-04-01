package entx

import (
	"context"
	"testing"
)

func TestTaskConcurrencyLimitFromContext(t *testing.T) {
	ctx := WithTaskConcurrencyLimit(context.Background(), 3)

	got, ok := TaskConcurrencyLimitFromContext(ctx)
	if !ok {
		t.Fatal("expected context value to exist")
	}
	if got != 3 {
		t.Fatalf("got %d, want 3", got)
	}
}

func TestTaskConcurrencyLimitFromContextMissing(t *testing.T) {
	if _, ok := TaskConcurrencyLimitFromContext(context.Background()); ok {
		t.Fatal("expected missing context value")
	}
}
