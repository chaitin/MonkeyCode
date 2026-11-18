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
	if phase == "running" && usable && e.Desired == "running" {
		err := s.prepayBillingHour(ctx, q, tx, e)
		var denied *failure
		if errors.As(err, &denied) && (denied.code == "insufficient_credits" || denied.code == "billing_unavailable") {
			return s.stopBillingEnvironment(ctx, q, e, denied.code)
		}
		return err
	}
	p, err := q.LockOpenBillingPeriod(ctx, e.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// 预付区间不延长、不退款。尚未启动完成时保留已购买小时。
	if phase == "running" && p.PrepaidUntil != nil {
		return nil
	}
	if _, err = q.CloseBillingPeriod(ctx, p.ID); err != nil {
		return err
	}
	s.wakeBilling()
	return nil
}

func (s *Service) settlePeriod(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, p sqlc.EnvironmentBillingPeriod) error {
	if p.PrepaidUntil != nil {
		return nil
	}
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
	var stopped []sqlc.Environment
	at := s.now().UTC().Truncate(time.Second)
	for _, env := range rows {
		if _, err := q.PaidBillingHour(ctx, sqlc.PaidBillingHourParams{EnvironmentID: env.ID, PrepaidUntil: &at}); err == nil {
			continue
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err := s.stopBillingEnvironment(ctx, q, env, reason); err != nil {
			return nil, err
		}
		stopped = append(stopped, env)
	}
	return stopped, nil
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
				if p.ClosedAt == nil {
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
		envs, err := q.BilledUserEnvironments(ctx, user)
		if err != nil {
			return err
		}
		for _, env := range envs {
			if _, err := q.PaidBillingHour(ctx, sqlc.PaidBillingHourParams{EnvironmentID: env.ID, PrepaidUntil: &at}); err == nil {
				continue
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			// 未确认运行的时间不追补扣费；已到期且失联的环境转为停止目标。
			if env.Phase != "running" || env.ObservedGeneration != env.Generation || env.ObservedAt == nil || at.Sub(*env.ObservedAt) > 90*time.Second {
				if err := s.stopBillingEnvironment(ctx, q, env, "billing_unavailable"); err != nil {
					return err
				}
				stopped = append(stopped, env)
				continue
			}
			if err := s.prepayBillingHour(ctx, q, tx, env); err != nil {
				var denied *failure
				if !errors.As(err, &denied) || denied.code != "insufficient_credits" {
					return err
				}
				if err := s.stopBillingEnvironment(ctx, q, env, "insufficient_credits"); err != nil {
					return err
				}
				stopped = append(stopped, env)
			}
		}
		return nil
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
	for {
		if err := s.settleBilling(ctx, false); err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "环境计费结算失败", "error", err)
		}
		at := s.now().UTC()
		expiry, err := sqlc.New(s.pool).NextBillingExpiry(ctx, at)
		delay := time.Minute
		if err == nil && expiry.After(at) && expiry.Sub(at) < delay {
			delay = expiry.Sub(at)
		}
		// 一分钟仅作恢复检查；实际扣款只发生在每台环境的已付费小时到期后。
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		case <-s.billingWake:
			timer.Stop()
		}
	}
}
