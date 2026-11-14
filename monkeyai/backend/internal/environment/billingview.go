package environment

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/jackc/pgx/v5"
)

type BillingView struct {
	Enabled        bool           `json:"enabled"`
	State          string         `json:"state"`
	HourlyCredits  billing.Amount `json:"hourly_credits"`
	SettledCredits string         `json:"settled_credits"`
	SettledSeconds int64          `json:"settled_seconds"`
	StopReason     string         `json:"stop_reason,omitempty"`
	Budget         *BillingBudget `json:"budget,omitempty"`
}
type BillingBudget struct {
	Balance             billing.Amount `json:"balance"`
	HourlyCredits       string         `json:"hourly_credits"`
	RemainingSeconds    *int64         `json:"remaining_seconds"`
	RunningEnvironments int            `json:"running_environments"`
	LowBalance          bool           `json:"low_balance"`
}

func (s *Service) billingBudget(ctx context.Context, user string) (*BillingBudget, bool, error) {
	var out *BillingBudget
	active := false
	err := s.transactionWithTx(ctx, func(q *sqlc.Queries, tx pgx.Tx) error {
		hosts, err := q.UserEnvironmentHosts(ctx, user)
		if err != nil {
			return err
		}
		for _, h := range hosts {
			b, err := decodeBilling(h.Billing)
			if err != nil {
				return err
			}
			if b.Enabled && (b.CPU > 0 || b.Memory > 0) {
				active = true
			}
		}
		if !active {
			return nil
		}
		if s.credits == nil {
			return errors.New("环境积分计费服务不可用")
		}
		active, err = s.credits.ComputeEnabled(ctx, tx)
		if err != nil || !active {
			return err
		}
		if _, err = q.ActiveUser(ctx, user); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return err
		}
		at := s.now().UTC()
		a, err := s.credits.ComputeAccount(ctx, tx, user, at)
		if err != nil {
			return err
		}
		periods, err := q.UserBillingPeriods(ctx, sqlc.UserBillingPeriodsParams{UserID: user, ConfirmedUntil: at.Add(-90 * time.Second)})
		if err != nil {
			return err
		}
		rate := new(big.Int)
		for _, p := range periods {
			pricing, err := decodeBilling(p.Pricing)
			if err != nil {
				return err
			}
			hourly, err := computePrice(pricing, p.CpuMillis, p.MemoryBytes, 3600)
			if err != nil {
				return err
			}
			rate.Add(rate, big.NewInt(int64(hourly)))
		}
		out = &BillingBudget{Balance: a.Available, HourlyCredits: new(big.Rat).SetFrac(rate, big.NewInt(1000000)).FloatString(6), RunningEnvironments: len(periods)}
		if rate.Sign() > 0 {
			remaining := new(big.Int).Mul(big.NewInt(int64(a.Available)), big.NewInt(3600))
			remaining.Quo(remaining, rate)
			seconds := int64(0)
			if remaining.Sign() > 0 {
				seconds = math.MaxInt64
				if remaining.IsInt64() {
					seconds = remaining.Int64()
				}
			}
			out.RemainingSeconds = new(seconds)
			out.LowBalance = seconds <= 300
		}
		return nil
	})
	return out, active, err
}
func (s *Service) billingViews(ctx context.Context, items []View) error {
	if len(items) == 0 {
		return nil
	}
	q := sqlc.New(s.pool)
	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	summaries, err := q.BillingSummaries(ctx, ids)
	if err != nil {
		return err
	}
	byID := make(map[string]sqlc.BillingSummariesRow, len(summaries))
	for _, p := range summaries {
		byID[p.EnvironmentID] = p
	}
	type budgetResult struct {
		value   *BillingBudget
		enabled bool
	}
	budgets := make(map[string]budgetResult)
	hosts := make(map[string]BillingConfig)
	for i := range items {
		e := &items[i]
		b, ok := hosts[e.HostID]
		if !ok {
			h, err := q.HostSetup(ctx, e.HostID)
			if err != nil {
				return err
			}
			b, err = decodeBilling(h.Billing)
			if err != nil {
				return err
			}
			hosts[e.HostID] = b
		}
		enabled := b.Enabled && (b.CPU > 0 || b.Memory > 0)
		budget := budgetResult{}
		if enabled {
			var ok bool
			budget, ok = budgets[e.UserID]
			if !ok {
				budget.value, budget.enabled, err = s.billingBudget(ctx, e.UserID)
				if err != nil {
					return err
				}
				budgets[e.UserID] = budget
			}
			enabled = budget.enabled
		}
		v := &BillingView{Enabled: enabled, State: "disabled", SettledCredits: "0", StopReason: e.BillingStopReason, Budget: budget.value}
		if enabled {
			v.State = "waiting"
		}
		if p, ok := byID[e.ID]; ok {
			v.SettledCredits = p.Amount
			v.SettledSeconds = p.Seconds
			if enabled {
				if p.Running {
					v.State = "running"
				}
				if e.Stale || e.Phase == "failed" {
					v.State = "unknown"
				}
			}
		}
		if enabled {
			var spec Spec
			if err := json.Unmarshal(e.Spec, &spec); err != nil {
				return err
			}
			v.HourlyCredits, err = computePrice(b, spec.Resource.CPUMillis, spec.Resource.MemoryBytes, 3600)
			if err != nil {
				return err
			}
			if e.Phase == "stopped" || e.Phase == "deleted" {
				v.State = "stopped"
			}
		}
		e.Billing = v
	}
	return nil
}
