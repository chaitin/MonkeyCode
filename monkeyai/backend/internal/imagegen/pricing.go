package imagegen

import (
	"errors"
	"math/big"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
)

const creditScale = 1_000_000

func Quote(item model.Model, operation, quality, aspectRatio string) (billing.Amount, error) {
	if item.Kind != model.KindImage || item.ImageConfig == nil || item.ImagePricing == nil {
		return 0, errors.New("模型没有生图积分配置")
	}
	if !slices.Contains(item.ImageConfig.Qualities, quality) || !slices.Contains(item.ImageConfig.AspectRatios, aspectRatio) {
		return 0, errors.New("画质或比例不可用")
	}
	if operation != "generate" && operation != "edit" {
		return 0, errors.New("生图操作无效")
	}
	base, err := billing.ParseAmount(item.ImagePricing.BaseCreditsPerImage)
	if err != nil || base < 0 {
		return 0, errors.New("生图基础积分无效")
	}
	amount := big.NewInt(int64(base))
	denominator := big.NewInt(1)
	for _, part := range []struct {
		name        string
		multipliers []model.ImageMultiplier
	}{
		{quality, item.ImagePricing.QualityMultipliers},
		{aspectRatio, item.ImagePricing.AspectMultipliers},
		{operation, item.ImagePricing.OperationMultipliers},
	} {
		multiplier := billing.Amount(creditScale)
		for _, candidate := range part.multipliers {
			if candidate.Name != part.name {
				continue
			}
			multiplier, err = billing.ParseAmount(candidate.Multiplier)
			if err != nil || multiplier <= 0 {
				return 0, errors.New("生图积分倍率无效")
			}
			break
		}
		amount.Mul(amount, big.NewInt(int64(multiplier)))
		denominator.Mul(denominator, big.NewInt(creditScale))
	}
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(amount, denominator, remainder)
	if remainder.Mul(remainder, big.NewInt(2)).Cmp(denominator) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsInt64() {
		return 0, errors.New("生图积分超出范围")
	}
	result := billing.Amount(quotient.Int64())
	if _, err := billing.ParseAmount(result.String()); err != nil {
		return 0, err
	}
	return result, nil
}
