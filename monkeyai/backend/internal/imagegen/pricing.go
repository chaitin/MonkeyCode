package imagegen

import (
	"errors"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
)

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
	return item.ImagePricing.ImageCredits(quality)
}
