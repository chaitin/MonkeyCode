package environment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

func (s *Service) wakeBilling() {
	select {
	case s.billingWake <- struct{}{}:
	default:
	}
}

func (s *Service) observeBilling(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, e sqlc.Environment, phase string, usable bool) error {
	at := s.now().UTC().Truncate(time.Second)
	p, err := q.LockOpenBillingPeriod(ctx, e.ID)
	open := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if open && (at.Sub(p.ConfirmedUntil) > 90*time.Second || (phase == "running" && p.Generation != e.Generation)) {
		if _, err = q.CloseBillingPeriod(ctx, p.ID); err != nil {
			return err
		}
		s.wakeBilling()
		open = false
	}
	if phase != "running" || !usable {
		if !open {
			return nil
		}
		if phase == "stopped" || phase == "deleted" {
			if _, err = q.ConfirmBillingPeriod(ctx, sqlc.ConfirmBillingPeriodParams{ID: p.ID, ConfirmedUntil: at}); err != nil {
				return err
			}
		}
		if _, err = q.CloseBillingPeriod(ctx, p.ID); err != nil {
			return err
		}
		s.wakeBilling()
		return nil
	}
	b, err := s.billingConfig(ctx, q, tx, e.HostID)
	if err != nil {
		return err
	}
	if !b.Enabled || b.CPU == 0 && b.Memory == 0 {
		if open {
			_, err = q.CloseBillingPeriod(ctx, p.ID)
			s.wakeBilling()
		}
		return err
	}
	var previous BillingConfig
	if open {
		previous, err = decodeBilling(p.Pricing)
		if err != nil {
			return err
		}
	}
	if open && previous.CPU == b.CPU && previous.Memory == b.Memory && p.CpuMillis == e.CpuMillis && p.MemoryBytes == e.MemoryBytes {
		_, err = q.ConfirmBillingPeriod(ctx, sqlc.ConfirmBillingPeriodParams{ID: p.ID, ConfirmedUntil: at})
		return err
	}
	if open {
		if _, err = q.CloseBillingPeriod(ctx, p.ID); err != nil {
			return err
		}
		s.wakeBilling()
	}
	raw, _ := json.Marshal(resource.Object{"cpu_credits_per_core_hour": b.CPU, "memory_credits_per_gib_hour": b.Memory})
	_, err = q.OpenBillingPeriod(ctx, sqlc.OpenBillingPeriodParams{EnvironmentID: e.ID, UserID: e.UserID, Generation: e.Generation, Pricing: raw, CpuMillis: e.CpuMillis, MemoryBytes: e.MemoryBytes, StartedAt: at})
	return err
}

func (s *Service) settlePeriod(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, p sqlc.EnvironmentBillingPeriod) error {
	b, err := decodeBilling(p.Pricing)
	if err != nil {
		return err
	}
	env, err := q.BillingEnvironment(ctx, p.EnvironmentID)
	if err != nil {
		return err
	}
	seconds := p.SettledSeconds
	amount, err := billing.ParseAmount(p.SettledAmount)
	if err != nil {
		return err
	}
	until := p.ConfirmedUntil
	for cursor := p.StartedAt.Add(time.Duration(seconds) * time.Second); cursor.Before(until); {
		a, err := s.credits.ComputeAccount(ctx, tx, p.UserID, cursor)
		if err != nil {
			return err
		}
		end := until
		if a.End.Before(end) {
			end = a.End
		}
		if !end.After(cursor) {
			return errors.New("环境积分账户周期无效")
		}
		next := int64(end.Sub(p.StartedAt) / time.Second)
		total, err := computePrice(b, p.CpuMillis, p.MemoryBytes, next)
		if err != nil {
			return err
		}
		usage, _ := json.Marshal(resource.Object{"known": true, "result": "succeeded", "environment_id": p.EnvironmentID, "period_id": p.ID, "from": cursor, "until": end, "duration_seconds": next - seconds, "cpu_millis": p.CpuMillis, "memory_bytes": p.MemoryBytes})
		err = s.credits.ChargeCompute(ctx, tx, billing.ComputeCharge{UserID: p.UserID, AccountID: a.ID, EnvironmentID: p.EnvironmentID, Name: env.Name, Key: fmt.Sprintf("environment:%s:%d:%d", p.ID, seconds, next), From: cursor, Until: end, Amount: total - amount, Pricing: p.Pricing, Usage: usage})
		if err != nil {
			return err
		}
		seconds, amount, cursor = next, total, end
	}
	return q.SetBillingSettlement(ctx, sqlc.SetBillingSettlementParams{ID: p.ID, SettledSeconds: seconds, SettledAmount: amount.String()})
}

func (s *Service) stopBillingUser(ctx context.Context, q *sqlc.Queries, user, reason string) ([]sqlc.Environment, error) {
	rows, err := q.BilledUserEnvironments(ctx, user)
	if err != nil {
		return nil, err
	}
	for _, env := range rows {
		spec, err := executionSpec(env)
		if err != nil {
			return nil, err
		}
		spec.Generation++
		spec.DesiredState = "stopped"
		spec.RuntimePackage = nil
		raw := saveSpec(spec)
		if err = q.SupersedeOperations(ctx, env.ID); err != nil {
			return nil, err
		}
		if _, err = q.ChangeTarget(ctx, sqlc.ChangeTargetParams{ID: env.ID, InstanceID: env.InstanceID, Desired: "stopped", Spec: raw}); err != nil {
			return nil, err
		}
		if err = q.SetBillingStopReason(ctx, sqlc.SetBillingStopReasonParams{ID: env.ID, BillingStopReason: reason}); err != nil {
			return nil, err
		}
		if _, err = q.CreateOperation(ctx, sqlc.CreateOperationParams{EnvironmentID: env.ID, Generation: spec.Generation, Desired: "stopped", RequestKey: "billing-" + resource.ID(), RequestHash: hash(reason)}); err != nil {
			return nil, err
		}
	}
	return rows, nil
}

func (s *Service) billUser(ctx context.Context, user string, closedOnly bool) error {
	var stopped []sqlc.Environment
	err := s.transactionWithTx(ctx, func(q *sqlc.Queries, tx pgx.Tx) error {
		at := s.now().UTC().Truncate(time.Second)
		hosts, err := q.UserEnvironmentHosts(ctx, user)
		if err != nil {
			return err
		}
		active := false
		for _, h := range hosts {
			b, err := decodeBilling(h.Billing)
			if err != nil {
				return err
			}
			if b.Enabled && (b.CPU > 0 || b.Memory > 0) {
				active = true
			} else {
				if err = q.CloseHostBillingPeriods(ctx, h.HostID); err != nil {
					return err
				}
			}
		}
		var configErr error
		if active {
			if s.credits == nil {
				configErr = errors.New("环境积分计费服务不可用")
			} else {
				active, configErr = s.credits.ComputeEnabled(ctx, tx)
			}
		}
		if configErr != nil || !active {
			if err = q.CloseUserBillingPeriods(ctx, user); err != nil {
				return err
			}
		}
		for {
			rows, err := q.PendingBillingPeriods(ctx, sqlc.PendingBillingPeriodsParams{UserID: user, StaleAt: at.Add(-90 * time.Second), ClosedOnly: closedOnly})
			if err != nil {
				return err
			}
			for _, p := range rows {
				if p.ClosedAt == nil && at.Sub(p.ConfirmedUntil) > 90*time.Second {
					if _, err = q.CloseBillingPeriod(ctx, p.ID); err != nil {
						return err
					}
				}
				if s.credits == nil {
					return errors.New("环境积分计费服务不可用")
				}
				if err = s.settlePeriod(ctx, q, tx, p); err != nil {
					return err
				}
			}
			if len(rows) < 128 {
				break
			}
		}
		if configErr != nil {
			var err error
			stopped, err = s.stopBillingUser(ctx, q, user, "billing_unavailable")
			return err
		}
		if !active {
			return nil
		}
		if _, err := q.ActiveUser(ctx, user); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return err
		}
		a, err := s.credits.ComputeAccount(ctx, tx, user, at)
		if err != nil {
			return err
		}
		if a.Available <= 0 {
			stopped, err = s.stopBillingUser(ctx, q, user, "insufficient_credits")
		}
		return err
	})
	if err == nil && s.disconnect != nil {
		for _, env := range stopped {
			runtime, lookupErr := sqlc.New(s.pool).GetRuntime(ctx, env.ID)
			if lookupErr == nil && runtime.MachineID != nil {
				s.disconnect(env.UserID, *runtime.MachineID)
			}
		}
	}
	return err
}

func (s *Service) settleBilling(ctx context.Context, closedOnly bool) error {
	users, err := sqlc.New(s.pool).BillingUsers(ctx, s.now().UTC().Add(-90*time.Second))
	if err != nil {
		return err
	}
	var failures []error
	for _, user := range users {
		if err = s.billUser(ctx, user, closedOnly); err != nil {
			failures = append(failures, fmt.Errorf("用户 %s 环境结算失败: %w", user, err))
		}
	}
	return errors.Join(failures...)
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	closedOnly := false
	for {
		if err := s.settleBilling(ctx, closedOnly); err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "环境计费结算失败", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			closedOnly = false
		case <-s.billingWake:
			closedOnly = true
		}
	}
}
