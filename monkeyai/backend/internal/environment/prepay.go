package environment

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

// 购买和启动共用环境事务及账户锁；已购买的小时不因停止、调价或余额变化失效。
func (s *Service) prepayBillingHour(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, e sqlc.Environment) error {
	at := s.now().UTC().Truncate(time.Second)
	if _, err := q.ActiveUser(ctx, e.UserID); errors.Is(err, pgx.ErrNoRows) {
		return conflict("billing_unavailable", "用户已停用或删除，无法启动或续费")
	} else if err != nil {
		return err
	}
	if _, err := q.PaidBillingHour(ctx, sqlc.PaidBillingHourParams{EnvironmentID: e.ID, PrepaidUntil: &at}); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	b, err := s.billingConfig(ctx, q, tx, e.HostID)
	if err != nil {
		return err
	}
	if !b.Enabled || b.CPU == 0 && b.Memory == 0 {
		return nil
	}
	// 旧按秒区间仅结清已确认用量，不补收断线时间，也不改写历史单价。
	if p, err := q.LockOpenBillingPeriod(ctx, e.ID); err == nil {
		if _, err = q.CloseBillingPeriod(ctx, p.ID); err != nil {
			return err
		}
		if p.PrepaidUntil == nil {
			if err = s.settlePeriod(ctx, q, tx, p); err != nil {
				return err
			}
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	hourly, err := computePrice(b, e.CpuMillis, e.MemoryBytes, 3600)
	if err != nil {
		return err
	}
	a, err := s.credits.ComputeAccount(ctx, tx, e.UserID, at)
	if err != nil {
		return err
	}
	if a.Available < hourly {
		return &failure{402, "insufficient_credits", "积分不足以预付一小时"}
	}
	raw, _ := json.Marshal(resource.Object{"cpu_credits_per_core_hour": b.CPU, "memory_credits_per_gib_hour": b.Memory})
	p, err := q.OpenPrepaidBillingHour(ctx, sqlc.OpenPrepaidBillingHourParams{
		EnvironmentID: e.ID, UserID: e.UserID, Generation: e.Generation,
		Pricing: raw, CpuMillis: e.CpuMillis, MemoryBytes: e.MemoryBytes, StartedAt: at,
	})
	if err != nil {
		return err
	}
	until := at.Add(time.Hour)
	usage, _ := json.Marshal(resource.Object{"known": true, "result": "succeeded",
		"billing_mode": "hourly_prepaid", "environment_id": e.ID, "period_id": p.ID,
		"from": at, "until": until, "duration_seconds": 3600,
		"cpu_millis": e.CpuMillis, "memory_bytes": e.MemoryBytes})
	if err = s.credits.ChargeCompute(ctx, tx, billing.ComputeCharge{
		Prepaid: true, UserID: e.UserID, AccountID: a.ID, EnvironmentID: e.ID,
		Name: e.Name, Key: "environment:prepaid:" + p.ID, From: at, Until: until,
		Amount: hourly, Pricing: raw, Usage: usage,
	}); err != nil {
		return err
	}
	return q.SetBillingSettlement(ctx, sqlc.SetBillingSettlementParams{ID: p.ID, SettledSeconds: 3600, SettledAmount: hourly.String()})
}

func (s *Service) stopBillingEnvironment(ctx context.Context, q *sqlc.Queries, env sqlc.Environment, reason string) error {
	if env.Desired != "running" {
		return nil
	}
	spec, err := executionSpec(env)
	if err != nil {
		return err
	}
	spec.Generation++
	spec.stop()
	if err = q.SupersedeOperations(ctx, env.ID); err != nil {
		return err
	}
	if _, err = q.ChangeTarget(ctx, sqlc.ChangeTargetParams{ID: env.ID, InstanceID: env.InstanceID, Desired: "stopped", Spec: saveSpec(spec)}); err != nil {
		return err
	}
	if err = q.SetBillingStopReason(ctx, sqlc.SetBillingStopReasonParams{ID: env.ID, BillingStopReason: reason}); err != nil {
		return err
	}
	if p, err := q.LockOpenBillingPeriod(ctx, env.ID); err == nil {
		if _, err = q.CloseBillingPeriod(ctx, p.ID); err != nil {
			return err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	_, err = q.CreateOperation(ctx, sqlc.CreateOperationParams{EnvironmentID: env.ID, Generation: spec.Generation, Desired: "stopped", RequestKey: "billing-" + resource.ID(), RequestHash: hash(reason)})
	return err
}
