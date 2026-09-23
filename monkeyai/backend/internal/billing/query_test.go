package billing

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestAccountDifferences(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	query := sqlc.New(s.pool)
	account, err := s.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	check := func(want int) []resource.Object {
		t.Helper()
		differences, err := resource.DecodeObjects(query.AccountDifferences(ctx))
		if err != nil {
			t.Fatal(err)
		}
		if len(differences) != want {
			t.Fatalf("账户差异数量错误: got=%d want=%d differences=%v", len(differences), want, differences)
		}
		return differences
	}

	check(0)
	if _, err = s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"}); err != nil {
		t.Fatal(err)
	}
	check(0)

	if _, err = s.pool.Exec(ctx, `UPDATE credit_accounts SET frozen = frozen + 1 WHERE id = $1`, account.ID); err != nil {
		t.Fatal(err)
	}
	differences := check(1)
	if differences[0].String("account_id") != account.ID || differences[0].String("frozen") == differences[0].String("reserved") {
		t.Fatalf("未识别冻结额差异: %v", differences[0])
	}

	if _, err = s.pool.Exec(ctx, `UPDATE credit_accounts SET frozen = frozen - 1, balance = balance - 1 WHERE id = $1`, account.ID); err != nil {
		t.Fatal(err)
	}
	differences = check(1)
	if differences[0].String("balance") == differences[0].String("ledger_balance") {
		t.Fatalf("未识别账本余额差异: %v", differences[0])
	}
}
