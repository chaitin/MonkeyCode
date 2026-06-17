package billing

import (
	"context"
	"testing"
)

func TestNoopAllowsConsume(t *testing.T) {
	b := NewNoop()
	if err := b.CanConsume(context.Background(), nil); err != nil {
		t.Fatalf("CanConsume() error = %v", err)
	}
	if err := b.Consume(context.Background(), nil); err != nil {
		t.Fatalf("Consume() error = %v", err)
	}
}
