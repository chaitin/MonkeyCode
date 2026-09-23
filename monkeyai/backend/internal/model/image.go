package model

import (
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
)

func marshalImageFields(item Model) ([]byte, []byte, []byte, error) {
	options := []byte(item.ProviderOptions)
	if len(options) == 0 {
		options = []byte("{}")
	}
	var config, pricing []byte
	var err error
	if item.ImageConfig != nil {
		config, err = json.Marshal(item.ImageConfig)
		if err != nil {
			return nil, nil, nil, err
		}
	}
	if item.ImagePricing != nil {
		pricing, err = json.Marshal(item.ImagePricing)
		if err != nil {
			return nil, nil, nil, err
		}
	}
	return options, config, pricing, nil
}

func userImagePricing(kind Kind) *ImagePricing {
	if kind != KindImage {
		return nil
	}
	return &ImagePricing{BaseCreditsPerImage: "0"}
}

func validateImageModel(item *Model) error {
	if !slices.Contains([]Provider{ProviderOpenAIImages, ProviderOpenAIResponses, ProviderVolcengine, ProviderXAI}, item.Provider) {
		return errors.New("生图模型 provider 无效")
	}
	if item.AdvancedConfig != (AdvancedConfig{}) {
		return errors.New("生图模型不能设置文本 Token 配置")
	}
	if item.CreditMultiplier != 0 && item.CreditMultiplier != 1 {
		return errors.New("生图模型不能设置文本积分倍率")
	}
	item.CreditMultiplier = 1
	if item.ImageConfig == nil || item.ImagePricing == nil {
		return errors.New("生图模型必须配置画质、比例和积分")
	}
	if len(item.ProviderOptions) != 0 {
		var options map[string]json.RawMessage
		if err := json.Unmarshal(item.ProviderOptions, &options); err != nil || options == nil {
			return errors.New("provider_options 必须是 JSON 对象")
		}
	}
	if err := validateImageConfig(item.ImageConfig); err != nil {
		return err
	}
	return validateImagePricing(item.ImageConfig, item.ImagePricing)
}

func validateImageConfig(config *ImageConfig) error {
	if len(config.Qualities) == 0 || len(config.AspectRatios) == 0 || len(config.Qualities) > 16 || len(config.AspectRatios) > 16 {
		return errors.New("生图模型至少需要一种画质和比例")
	}
	qualities := make(map[string]bool, len(config.Qualities))
	for _, quality := range config.Qualities {
		if !validImageQuality(quality) || qualities[quality] {
			return errors.New("画质仅支持 1K、2K、4K 且不能重复")
		}
		qualities[quality] = true
	}
	if !qualities[config.DefaultQuality] {
		return errors.New("默认画质必须属于可选画质")
	}
	ratios := make(map[string]bool, len(config.AspectRatios))
	for _, ratio := range config.AspectRatios {
		if !validRatio(ratio) || ratios[ratio] {
			return errors.New("比例配置无效或重复")
		}
		ratios[ratio] = true
	}
	if !ratios[config.DefaultAspectRatio] {
		return errors.New("默认比例必须属于可选比例")
	}
	return nil
}

func validImageQuality(value string) bool {
	return value == ImageQuality1K || value == ImageQuality2K || value == ImageQuality4K
}

func validRatio(value string) bool {
	width, height, ok := strings.Cut(value, ":")
	if !ok || width == "" || height == "" {
		return false
	}
	w, errW := strconv.ParseUint(width, 10, 16)
	h, errH := strconv.ParseUint(height, 10, 16)
	if errW != nil || errH != nil || w == 0 || h == 0 || strconv.FormatUint(w, 10) != width || strconv.FormatUint(h, 10) != height {
		return false
	}
	return w <= 32 && h <= 32
}

func validateImagePricing(config *ImageConfig, pricing *ImagePricing) error {
	base, err := billing.ParseAmount(pricing.BaseCreditsPerImage)
	if err != nil || base < 0 {
		return errors.New("base_credits_per_image 必须是非负积分")
	}
	seen := make(map[string]bool, len(pricing.QualityMultipliers))
	for _, entry := range pricing.QualityMultipliers {
		if !slices.Contains(config.Qualities, entry.Name) || seen[entry.Name] {
			return errors.New("quality 倍率名称无效或重复")
		}
		seen[entry.Name] = true
		value, err := billing.ParseAmount(entry.Multiplier)
		if err != nil || value <= 0 {
			return errors.New("quality 倍率必须大于 0")
		}
	}
	return nil
}
