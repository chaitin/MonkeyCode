package billing

import (
	"errors"
	"os"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestSmallBalanceSettlement(t *testing.T) {
	for _, mode := range []string{"local", "remote"} {
		for _, category := range []string{"model", "tool"} {
			for _, result := range []string{"succeeded", "failed"} {
				t.Run(mode+"/"+category+"/"+result, func(t *testing.T) {
					s, user, model := fixture(t)
					ctx := t.Context()
					p := defaultPolicy()
					p.Enabled, p.Mode, p.RootCredits = true, mode, amountText("0.000001")
					setPolicy(t, s, p)
					if mode == "remote" {
						s.WithWallet(&Wallet{Client: &walletStub{}, BaseURL: "https://baizhiyun.vip", AppID: 4})
						addWalletIdentity(t, s, user, "1001")
						if err := s.BindWallet(ctx, user, user, "1001"); err != nil {
							t.Fatal(err)
						}
					}
					req := Request{UserID: user, ResourceID: model, Category: category}
					reserve, charge := amountText("14"), amountText("1.48")
					usage := Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: result}
					if category == "tool" {
						req.ConnectorID, req.ResourceID = resource.ID(), resource.ID()
						if _, err := s.pool.Exec(ctx, `INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode,authorization_method) VALUES($1,$2,'收费工具','https://example.com','centralized','http_header')`, req.ConnectorID, user); err != nil {
							t.Fatal(err)
						}
						if _, err := s.pool.Exec(ctx, `INSERT INTO mcp_tools(id,connector_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,'search',true,2.5,1)`, req.ResourceID, req.ConnectorID); err != nil {
							t.Fatal(err)
						}
						reserve, charge = amountText("2.5"), amountText("2.5")
						usage = Usage{Known: true, Result: result}
					}
					if result == "failed" {
						charge = 0
						usage = Usage{Known: true, Result: result}
					}
					r, err := s.Begin(ctx, req)
					if err != nil {
						t.Fatalf("正余额不足预留额时仍应获准执行: %v", err)
					}
					a, err := s.Account(ctx, user)
					if err != nil || a.Balance != p.RootCredits || a.Frozen != reserve || a.Available != p.RootCredits-reserve {
						t.Fatalf("应完整冻结预留额: %+v %v", a, err)
					}
					if _, err := s.Begin(ctx, req); !errors.Is(err, insufficient) {
						t.Fatalf("超额冻结期间不能继续透支: %v", err)
					}
					if err := s.Start(ctx, r.ID); err != nil {
						t.Fatal(err)
					}
					for range 2 {
						if err := s.Finish(ctx, r.ID, usage); err != nil {
							t.Fatal(err)
						}
					}
					a, err = s.Account(ctx, user)
					if err != nil || a.Balance != p.RootCredits-charge || a.Frozen != 0 || a.Available != a.Balance {
						t.Fatalf("应按实际费用结算且释放冻结: %+v %v", a, err)
					}
					var status, total string
					if err := s.pool.QueryRow(ctx, `SELECT status FROM billing_transactions WHERE id=$1`, r.ID).Scan(&status); err != nil {
						t.Fatal(err)
					}
					wantStatus := "settled"
					if result == "failed" {
						wantStatus = "released"
					}
					if status != wantStatus {
						t.Fatalf("交易状态: %s，期望 %s", status, wantStatus)
					}
					if err := s.pool.QueryRow(ctx, `SELECT sum(credit_delta)::text FROM credit_ledger_entries WHERE account_id=$1`, a.ID).Scan(&total); err != nil || amountText(total) != a.Balance {
						t.Fatalf("流水应与余额一致: %s %+v %v", total, a, err)
					}
					next, err := s.Begin(ctx, req)
					if charge > 0 {
						if !errors.Is(err, insufficient) {
							t.Fatalf("负余额不能再次调用: %v", err)
						}
					} else {
						if err != nil {
							t.Fatalf("未消费的预留释放后应可再次调用: %v", err)
						}
						if err := s.Release(ctx, next.ID, "not_sent"); err != nil {
							t.Fatal(err)
						}
					}
				})
			}
		}
	}
}

func TestOverdraftMigration(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	a, err := s.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	up, err := os.ReadFile("../../migrations/000004_credit_account_overdraft.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	down, err := os.ReadFile("../../migrations/000004_credit_account_overdraft.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, string(down)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE credit_accounts SET balance=-0.48 WHERE id=$1`, a.ID); err == nil {
		t.Fatal("旧约束应拒绝负余额")
	}
	if _, err := s.pool.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	after, err := s.Account(ctx, user)
	if err != nil || after != a {
		t.Fatalf("迁移不应改变现有账户: %+v %v", after, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE credit_accounts SET balance=-0.48 WHERE id=$1`, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, string(down)); err == nil {
		t.Fatal("存在负余额时不能静默回滚")
	}
	if _, err := s.pool.Exec(ctx, `UPDATE credit_accounts SET frozen=-1 WHERE id=$1`, a.ID); err == nil {
		t.Fatal("回滚失败后仍应保留冻结额非负约束")
	}
	after, err = s.Account(ctx, user)
	if err != nil || after.Balance != amountText("-0.48") || after.Frozen != 0 {
		t.Fatalf("回滚失败不应截断余额: %+v %v", after, err)
	}
}

func TestNonpositiveBalanceAdmission(t *testing.T) {
	for _, balance := range []string{"0", "-0.01"} {
		for _, kind := range []string{"paid", "disabled", "user", "zero_price"} {
			t.Run(balance+"/"+kind, func(t *testing.T) {
				s, user, model := fixture(t)
				ctx := t.Context()
				p := defaultPolicy()
				p.Enabled = kind != "disabled"
				if kind == "zero_price" {
					p.Input, p.Cached, p.Output = 0, 0, 0
				}
				setPolicy(t, s, p)
				if kind == "user" {
					if _, err := s.pool.Exec(ctx, `UPDATE models SET ownership_type='user' WHERE id=$1`, model); err != nil {
						t.Fatal(err)
					}
				}
				a, err := s.Account(ctx, user)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := s.pool.Exec(ctx, `UPDATE credit_accounts SET balance=$2 WHERE id=$1`, a.ID, balance); err != nil {
					t.Fatal(err)
				}
				r, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
				if kind == "paid" {
					if !errors.Is(err, insufficient) {
						t.Fatalf("非正余额不能发起付费调用: %v", err)
					}
					return
				}
				if err != nil {
					t.Fatalf("免费调用不应受余额影响: %v", err)
				}
				if err := s.Start(ctx, r.ID); err != nil {
					t.Fatal(err)
				}
				if err := s.Finish(ctx, r.ID, Usage{Input: 10000, Output: 2000, Known: true, Result: "succeeded"}); err != nil {
					t.Fatal(err)
				}
				a, err = s.Account(ctx, user)
				if err != nil || a.Balance != amountText(balance) || a.Frozen != 0 {
					t.Fatalf("免费调用不应改变余额: %+v %v", a, err)
				}
			})
		}
	}
}
