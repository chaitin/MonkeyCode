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
	CPU    billing.Amount `json:"cpu_credits_per_core_hour"`
	Memory billing.Amount `json:"memory_credits_per_gib_hour"`
}

type CreditBilling interface {
	CheckComputeMode(context.Context, pgx.Tx) error
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

func globalPricing(ctx context.Context, q *sqlc.Queries) (BillingConfig, error) {
	raw, err := q.GlobalEnvironmentPricing(ctx)
	if err != nil {
		return BillingConfig{}, err
	}
	return decodeBilling(raw)
}

// 下发目标只检查现有覆盖，不购买新时段。
func (s *Service) targetCovered(ctx context.Context, q *sqlc.Queries, id string) (bool, error) {
	at := s.now().UTC()
	_, err := q.PaidBillingHour(ctx, sqlc.PaidBillingHourParams{EnvironmentID: id, PrepaidUntil: &at})
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	b, err := globalPricing(ctx, q)
	return b.CPU == 0 && b.Memory == 0, err
}

func (s *Service) billingConfig(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, host string) (BillingConfig, error) {
	d, err := q.HostSetup(ctx, host)
	if err != nil {
		return BillingConfig{}, err
	}
	b, err := decodeBilling(d.Billing)
	if err != nil || b.CPU == 0 && b.Memory == 0 {
		return b, err
	}
	if s.credits == nil {
		return b, conflict("billing_unavailable", "环境积分计费服务不可用")
	}
	return b, s.credits.CheckComputeMode(ctx, tx)
}

func (s *Service) billingAdmission(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, user, host string, cpu, memory int64) error {
	b, err := s.billingConfig(ctx, q, tx, host)
	if err != nil {
		return err
	}
	if b.CPU == 0 && b.Memory == 0 {
		return nil
	}
	a, err := s.credits.ComputeAccount(ctx, tx, user, s.now().UTC())
	if err != nil {
		return err
	}
	hourly, err := computePrice(b, cpu, memory, 3600)
	if err != nil {
		return err
	}
	if a.Available < hourly {
		return &failure{402, "insufficient_credits", "积分不足以预付一小时，无法创建或启动云环境"}
	}
	return nil
}
