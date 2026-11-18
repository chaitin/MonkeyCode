package environment

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/jackc/pgx/v5"
)

func TestRenewalRequiresFreshCurrentGeneration(t *testing.T) {
	now := time.Now()
	seen := now.Add(-90 * time.Second)
	e := sqlc.Environment{Desired: "running", Phase: "running", Generation: 2, ObservedGeneration: 2, ObservedAt: &seen}
	if !freshRunning(e, now) || freshRunning(e, now.Add(time.Millisecond)) {
		t.Fatal("续费观察窗口错误")
	}
	e.ObservedGeneration--
	if freshRunning(e, now) {
		t.Fatal("旧代次不能续费")
	}
}

type rejectedRenewal struct {
	CreditBilling
	id string
}

func (c rejectedRenewal) ChargeCompute(ctx context.Context, tx pgx.Tx, in billing.ComputeCharge) error {
	if in.EnvironmentID == c.id {
		return billing.ErrComputeInsufficientCredits
	}
	return c.CreditBilling.ChargeCompute(ctx, tx, in)
}

func TestRenewalTransactions(t *testing.T) {
	for _, scenario := range []string{"仅拉取", "余额拒绝", "模式拒绝", "并发续费", "删除历史"} {
		t.Run(scenario, func(t *testing.T) {
			s, user, host := fixture(t)
			// 默认计费策略以管理员身份初始化。
			if _, err := s.pool.Exec(t.Context(), "INSERT INTO users(id,name,email,role) VALUES(gen_random_uuid(),'计费管理员',gen_random_uuid()::text || '@example.com','admin')"); err != nil {
				t.Fatal(err)
			}
			credits := billing.NewService(s.pool)
			if err := credits.Initialize(t.Context()); err != nil {
				t.Fatal(err)
			}
			s.WithBilling(credits)
			at := time.Now().UTC()
			s.now = func() time.Time { return at }
			create := func(key string) View {
				r, err := s.Create(t.Context(), user, Creation{testSpecification(), key, key})
				if err != nil {
					t.Fatal(err)
				}
				return r.Environment
			}
			first := create("first-environment")
			other := create("other-environment")
			ctx := t.Context()
			exchange := func(obs ...Observation) error {
				raw, err := json.Marshal(Exchange{Protocol: 1, Results: obs})
				if err != nil {
					return err
				}
				_, err = s.ExchangeAt(ctx, host, raw, at)
				return err
			}
			if scenario == "删除历史" {
				for _, v := range []View{first, other} {
					r, err := s.Change(ctx, &user, v.ID, "deleted", Change{v.Generation, "delete-environment"})
					if err != nil {
						t.Fatal(err)
					}
					at = at.Add(time.Second)
					if err = exchange(observe(r.Environment, "deleted")); err != nil {
						t.Fatal(err)
					}
				}
				if _, err := s.pool.Exec(ctx, "UPDATE hosts SET deleted_at=now(),status='revoked' WHERE id=$1", host); err != nil {
					t.Fatal(err)
				}
				e, err := sqlc.New(s.pool).GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: first.ID, UserID: &user})
				if err != nil {
					t.Fatal(err)
				}
				items := []View{view(e)}
				if err = s.billingViews(ctx, items); err != nil {
					t.Fatal(err)
				}
				if items[0].Billing.SettledSeconds != 3600 {
					t.Fatal("历史账务缺失")
				}
				return
			}
			at = at.Add(time.Hour - time.Second)
			if err := exchange(observe(first, "running"), observe(other, "running")); err != nil {
				t.Fatal(err)
			}
			at = at.Add(2 * time.Second)
			want := 2
			switch scenario {
			case "仅拉取":
				if err := exchange(); err != nil {
					t.Fatal(err)
				}
			case "余额拒绝":
				s.WithBilling(rejectedRenewal{credits, first.ID})
				if err := exchange(observe(first, "running"), observe(other, "running")); err != nil {
					t.Fatal(err)
				}
				want = 3
			case "模式拒绝":
				if _, err := s.pool.Exec(ctx, `UPDATE settings SET value=jsonb_set(value,'{charging_mode}','"remote"') WHERE key='billing'`); err != nil {
					t.Fatal(err)
				}
				if err := exchange(observe(first, "running"), observe(other, "running")); err != nil {
					t.Fatal(err)
				}
			case "并发续费":
				ch := make(chan error, 1)
				go func() { ch <- s.billUser(ctx, user, false) }()
				err := exchange(observe(first, "running"), observe(other, "running"))
				otherErr := <-ch
				if err != nil || otherErr != nil {
					t.Fatal(err, otherErr)
				}
				want = 4
			}
			for _, query := range []string{"SELECT count(*) FROM environment_billing_periods WHERE user_id=$1", "SELECT count(*) FROM credit_ledger_entries WHERE category='environment' AND user_id=$1"} {
				var n int
				if err := s.pool.QueryRow(ctx, query, user).Scan(&n); err != nil || n != want {
					t.Fatalf("%s: %d，期望 %d，错误 %v", query, n, want, err)
				}
			}
			if scenario == "余额拒绝" || scenario == "模式拒绝" {
				for _, v := range []View{first, other} {
					e, err := sqlc.New(s.pool).GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: v.ID})
					if err != nil {
						t.Fatal(err)
					}
					stop := scenario == "模式拒绝" || v.ID == first.ID
					if (e.Desired == "stopped") != stop || e.ObservedAt == nil || at.Sub(*e.ObservedAt) > time.Millisecond {
						t.Fatal("宿主状态更新未独立提交", e)
					}
				}
			}
		})
	}
}
