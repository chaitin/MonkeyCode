package session

import (
	"context"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
)

func TestSessionUpdateAllowsChildReference(t *testing.T) {
	s, _, user, _ := sessionDBFixture(t)
	parent := resource.ID()
	if err := s.EnsureSession(t.Context(), user, parent, "", ""); err != nil {
		t.Fatal(err)
	}
	update, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer update.Rollback(context.Background())
	if _, err := readSession(t.Context(), update, parent, true); err != nil {
		t.Fatal(err)
	}
	child, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer child.Rollback(context.Background())
	if _, err := child.Exec(t.Context(), "SET LOCAL lock_timeout = '1s'"); err != nil {
		t.Fatal(err)
	}
	if err := sqlc.New(child).InsertPlaceholder(t.Context(), sqlc.InsertPlaceholderParams{
		ID: resource.ID(), OwnerUserID: user, ParentSessionID: parent, StartedAt: time.Now(),
	}); err != nil {
		t.Fatalf("更新会话阻塞子会话外键检查: %v", err)
	}
	if err := child.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
}
