package environment

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/jackc/pgx/v5"
)

type BillingView struct {
	State          string         `json:"state"`
	HourlyCredits  billing.Amount `json:"hourly_credits"`
	SettledCredits string         `json:"settled_credits"`
	SettledSeconds int64          `json:"settled_seconds"`
	StopReason     string         `json:"stop_reason,omitempty"`
	Budget         *BillingBudget `json:"budget,omitempty"`
	PrepaidUntil   *time.Time     `json:"prepaid_until,omitempty"`
}
type BillingBudget struct {
	Balance             billing.Amount `json:"balance"`
	HourlyCredits       string         `json:"hourly_credits"`
	RemainingSeconds    *int64         `json:"remaining_seconds"`
	RunningEnvironments int            `json:"running_environments"`
	LowBalance          bool           `json:"low_balance"`
}

func (s *Service) billingBudget(ctx context.Context, user string, pricing BillingConfig) (*BillingBudget, error) {
	var out *BillingBudget
	if pricing.CPU == 0 && pricing.Memory == 0 {
		return nil, nil
	}
	err := s.transactionWithTx(ctx, func(q *sqlc.Queries, tx pgx.Tx) error {
		if s.credits == nil {
			return errors.New("环境积分计费服务不可用")
		}
		if err := s.credits.CheckComputeMode(ctx, tx); err != nil {
			return err
		}
		if _, err := q.ActiveUser(ctx, user); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return err
		}
		at := s.now().UTC()
		a, err := s.credits.ComputeAccount(ctx, tx, user, at)
		if err != nil {
			return err
		}
		periods, err := q.UserPaidBillingHours(ctx, sqlc.UserPaidBillingHoursParams{UserID: user, PrepaidUntil: &at})
		if err != nil {
			return err
		}
		rate := new(big.Int)
		var earliest *time.Time
		for _, p := range periods {
			if p.PrepaidUntil != nil && (earliest == nil || p.PrepaidUntil.Before(*earliest)) {
				earliest = p.PrepaidUntil
			}
			hourly, err := computePrice(pricing, p.CpuMillis, p.MemoryBytes, 3600)
			if err != nil {
				return err
			}
			rate.Add(rate, big.NewInt(int64(hourly)))
		}
		out = &BillingBudget{Balance: a.Available, HourlyCredits: new(big.Rat).SetFrac(rate, big.NewInt(1000000)).FloatString(6), RunningEnvironments: len(periods)}
		if earliest != nil {
			seconds := max(int64(earliest.Sub(at)/time.Second), 0)
			out.RemainingSeconds = &seconds
			out.LowBalance = big.NewInt(int64(a.Available)).Cmp(rate) < 0
		}
		return nil
	})
	return out, err
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
	budgets := make(map[string]*BillingBudget)
	b, err := globalPricing(ctx, q)
	if err != nil {
		return err
	}
	priced := b.CPU > 0 || b.Memory > 0
	for i := range items {
		e := &items[i]
		var budget *BillingBudget
		if priced {
			var ok bool
			budget, ok = budgets[e.UserID]
			if !ok {
				budget, err = s.billingBudget(ctx, e.UserID, b)
				if err != nil {
					return err
				}
				budgets[e.UserID] = budget
			}
		}
		v := &BillingView{State: "free", SettledCredits: "0", StopReason: e.BillingStopReason, Budget: budget}
		if priced {
			v.State = "waiting"
		}
		if p, ok := byID[e.ID]; ok {
			if p.PrepaidUntil.After(time.Unix(0, 0)) {
				v.PrepaidUntil = &p.PrepaidUntil
			}
			v.SettledCredits = p.Amount
			v.SettledSeconds = p.Seconds
			if priced {
				if e.Desired == "running" && p.PrepaidUntil.After(s.now()) {
					v.State = "running"
				}
				if e.Stale || e.Phase == "failed" {
					v.State = "unknown"
				}
			}
		}
		if priced {
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
