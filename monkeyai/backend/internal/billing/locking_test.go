package billing

import (
	"context"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
)

func TestAccountAdmissionAllowsLedgerForeignKey(t *testing.T) {
	s, user, _ := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	admission, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer admission.Rollback(context.Background())
	if _, err := sqlc.New(admission).LockUser(t.Context(), user); err != nil {
		t.Fatal(err)
	}

	settlement, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer settlement.Rollback(context.Background())
	if _, err := settlement.Exec(t.Context(), "SET LOCAL lock_timeout = '1s'"); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlc.New(settlement).LockBalance(t.Context(), a.ID); err != nil {
		t.Fatal(err)
	}
	// 入场请求随后等待账户锁时，结算不能反过来等待用户外键锁。
	if err := ledger(t.Context(), settlement, a.ID, "", "concurrent-ledger", "adjustment", "other", "并发结算", 0, "local", nil); err != nil {
		t.Fatalf("用户序列化锁阻塞结算外键检查: %v", err)
	}
	if err := settlement.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
}
