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

type BillingConfig struct {
	Enabled bool           `json:"enabled"`
	CPU     billing.Amount `json:"cpu_credits_per_core_hour"`
	Memory  billing.Amount `json:"memory_credits_per_gib_hour"`
}

type CreditBilling interface {
	ComputeEnabled(context.Context, pgx.Tx) (bool, error)
	ComputeAccount(context.Context, pgx.Tx, string, time.Time) (billing.Account, error)
	ChargeCompute(context.Context, pgx.Tx, billing.ComputeCharge) error
}

func (s *Service) WithBilling(credits CreditBilling) *Service { s.credits = credits; return s }

func (b BillingConfig) validate() error {
	if b.CPU < 0 || b.Memory < 0 {
		return bad("环境单价不能为负数")
	}
	_, err := computePrice(b, 256000, 1024<<30, 3600)
	if err != nil {
		return bad("环境单价超出允许范围")
	}
	return nil
}

func computePrice(b BillingConfig, cpu, memory, seconds int64) (billing.Amount, error) {
	if cpu < 0 || memory < 0 || seconds < 0 || b.CPU < 0 || b.Memory < 0 {
		return 0, bad("环境计量参数无效")
	}
	cpuPart := new(big.Int).Mul(big.NewInt(int64(b.CPU)), big.NewInt(cpu))
	cpuPart.Mul(cpuPart, big.NewInt(1<<30))
	memoryPart := new(big.Int).Mul(big.NewInt(int64(b.Memory)), big.NewInt(memory))
	memoryPart.Mul(memoryPart, big.NewInt(1000))
	n := new(big.Int).Add(cpuPart, memoryPart)
	n.Mul(n, big.NewInt(seconds))
	d := new(big.Int).Mul(big.NewInt(1000*(1<<30)*3600), big.NewInt(1000000))
	return billing.ParseAmount(new(big.Rat).SetFrac(n, d).FloatString(6))
}

func decodeBilling(raw []byte) (BillingConfig, error) {
	var b BillingConfig
	if json.Unmarshal(raw, &b) != nil {
		return b, errors.New("环境计费配置无效")
	}
	return b, b.validate()
}

func (s *Service) billingConfig(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, host string) (BillingConfig, error) {
	d, err := q.HostSetup(ctx, host)
	if err != nil {
		return BillingConfig{}, err
	}
	b, err := decodeBilling(d.Billing)
	if err != nil || !b.Enabled || b.CPU == 0 && b.Memory == 0 {
		return b, err
	}
	if s.credits == nil {
		return b, conflict("billing_unavailable", "环境积分计费服务不可用")
	}
	enabled, err := s.credits.ComputeEnabled(ctx, tx)
	if err != nil {
		return b, err
	}
	b.Enabled = enabled
	return b, nil
}

func (s *Service) billingAdmission(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, user, host string) error {
	b, err := s.billingConfig(ctx, q, tx, host)
	if err != nil {
		return err
	}
	if !b.Enabled || b.CPU == 0 && b.Memory == 0 {
		return nil
	}
	a, err := s.credits.ComputeAccount(ctx, tx, user, s.now().UTC())
	if err != nil {
		return err
	}
	if a.Available <= 0 {
		return &failure{402, "insufficient_credits", "积分余额不足，无法创建或启动云环境"}
	}
	return nil
}
