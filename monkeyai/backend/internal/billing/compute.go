package billing

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

type ComputeCharge struct {
	UserID, AccountID, EnvironmentID, Name, Key string
	From, Until                                 time.Time
	Amount                                      Amount
	Pricing                                     json.RawMessage
	Usage                                       json.RawMessage
}

func (s *Service) ComputeEnabled(ctx context.Context, tx pgx.Tx) (bool, error) {
	p, err := s.policy(ctx, tx, false)
	if err != nil || !p.Enabled {
		return false, err
	}
	if p.Mode != "local" {
		return false, fail(409, "environment_billing_mode_unavailable", "云环境计费暂仅支持本地积分，请先关闭云环境收费再切换计费模式")
	}
	return true, nil
}

// 由环境用例持有控制锁，并与计量进度在同一事务内锁定账户、入账。
func (s *Service) ComputeAccount(ctx context.Context, tx pgx.Tx, user string, at time.Time) (Account, error) {
	q := sqlc.New(tx)
	owner, err := q.LockComputeUser(ctx, user)
	if err != nil {
		return Account{}, err
	}
	start, err := q.ComputeAccountStart(ctx, sqlc.ComputeAccountStartParams{UserID: user, At: at})
	if err == nil {
		return accountRow(ctx, tx, user, start)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, err
	}
	if owner.DeletedAt != nil {
		return Account{}, pgx.ErrNoRows
	}
	p, err := s.policy(ctx, tx, false)
	if err != nil {
		return Account{}, err
	}
	return s.ensureAccountAt(ctx, tx, user, p, at)
}

func (s *Service) ChargeCompute(ctx context.Context, tx pgx.Tx, in ComputeCharge) error {
	if in.Amount < 0 || !in.From.Before(in.Until) || in.Key == "" || len(in.Key) > 128 || !json.Valid(in.Pricing) || !json.Valid(in.Usage) {
		return resource.Invalid("环境计费区间或金额无效")
	}
	if in.Amount == 0 {
		return nil
	}
	q := sqlc.New(tx)
	a, err := q.LockComputeChargeAccount(ctx, in.AccountID)
	if err != nil {
		return err
	}
	if a.UserID != in.UserID {
		return resource.Invalid("环境计费账户不属于当前用户")
	}
	hash := resource.Hash(resource.Object{"account_id": in.AccountID, "environment_id": in.EnvironmentID, "from": in.From, "until": in.Until, "amount": in.Amount.String(), "pricing": in.Pricing, "usage": in.Usage})
	existing, err := q.IdempotentTransaction(ctx, sqlc.IdempotentTransactionParams{UserID: in.UserID, Category: "environment", IdempotencyKey: new(in.Key)})
	if err == nil {
		if existing.RequestHash != hash {
			return fail(409, "idempotency_conflict", "环境计费幂等键对应不同用量")
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	user, err := q.BillingUser(ctx, in.UserID)
	if err != nil {
		return err
	}
	account, err := accountRow(ctx, tx, in.UserID, a.PeriodStartAt)
	if err != nil {
		return err
	}
	id := resource.ID()
	_, err = q.CreateTransaction(ctx, sqlc.CreateTransactionParams{ID: id, UserID: in.UserID, AccountID: in.AccountID, Category: "environment", ResourceID: in.EnvironmentID, ItemName: in.Name, UserName: user.Name, UserEmail: user.Email, GroupID: account.GroupID, Mode: "local", Status: "settling", Reserve: in.Amount.String(), Pricing: in.Pricing, IdempotencyKey: in.Key, RequestHash: hash, StartedAt: in.From})
	if err != nil {
		return err
	}
	_, err = q.SaveUsage(ctx, sqlc.SaveUsageParams{ID: id, Status: "settled", Amount: new(in.Amount.String()), RawAmount: new(in.Amount.String()), Usage: in.Usage, Result: new("succeeded"), CompletedAt: new(in.Until)})
	if err != nil {
		return err
	}
	if _, err = q.ChargeBalance(ctx, sqlc.ChargeBalanceParams{ID: in.AccountID, Balance: in.Amount.String()}); err != nil {
		return err
	}
	return ledger(ctx, tx, in.AccountID, id, "charge:"+id, "charge", "environment", in.Name, -in.Amount, "local", resource.Object{"transaction_id": id, "environment_id": in.EnvironmentID, "from": in.From, "until": in.Until, "duration_seconds": int64(in.Until.Sub(in.From) / time.Second)})
}
