package model

import (
	"errors"
	"math/big"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
)

// ImageCredits returns the per-image price. Legacy configurations retain their
// original fixed-point multiplication and round once, to six decimal places.
func (p ImagePricing) ImageCredits(quality string) (billing.Amount, error) {
	if p.Rates != nil {
		if p.BaseCreditsPerImage != "" || len(p.QualityMultipliers) != 0 {
			return 0, errors.New("生图积分配置不能混用单张价格和倍率")
		}
		for _, rate := range p.Rates {
			if rate.Quality == quality {
				value, err := billing.ParseAmount(rate.CreditsPerImage)
				if err != nil || value < 0 {
					return 0, errors.New("生图单张积分价格无效")
				}
				return value, nil
			}
		}
		return 0, errors.New("该画质未配置单张积分价格")
	}
	base, err := billing.ParseAmount(p.BaseCreditsPerImage)
	if err != nil || base < 0 {
		return 0, errors.New("生图基础积分无效")
	}
	const scale = 1_000_000
	multiplier := billing.Amount(scale)
	for _, entry := range p.QualityMultipliers {
		if entry.Name == quality {
			multiplier, err = billing.ParseAmount(entry.Multiplier)
			if err != nil || multiplier <= 0 {
				return 0, errors.New("生图积分倍率无效")
			}
			break
		}
	}
	amount := new(big.Int).Mul(big.NewInt(int64(base)), big.NewInt(int64(multiplier)))
	denominator := big.NewInt(scale)
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(amount, denominator, remainder)
	if remainder.Mul(remainder, big.NewInt(2)).Cmp(denominator) >= 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsInt64() {
		return 0, errors.New("生图积分超出范围")
	}
	return billing.ParseAmount(billing.Amount(quotient.Int64()).String())
}

// presentImagePricing converts existing configurations without rewriting stored
// prices or historical billing snapshots.
func presentImagePricing(config *ImageConfig, pricing *ImagePricing) *ImagePricing {
	if config == nil || pricing == nil {
		return pricing
	}
	rates := make([]ImageRate, 0, len(config.Qualities))
	for _, quality := range config.Qualities {
		credits, err := pricing.ImageCredits(quality)
		if err != nil {
			return pricing
		}
		rates = append(rates, ImageRate{Quality: quality, CreditsPerImage: credits.String()})
	}
	return &ImagePricing{Rates: rates}
}
