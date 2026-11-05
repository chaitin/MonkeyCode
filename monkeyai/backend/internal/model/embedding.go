package model

import (
	"encoding/json"
	"errors"
)

const maxEmbeddingDimensions = 16000

func marshalEmbeddingConfig(item Model) ([]byte, error) {
	if item.EmbeddingConfig == nil {
		return nil, nil
	}
	return json.Marshal(item.EmbeddingConfig)
}

func validateEmbeddingModel(item *Model) error {
	if item.Protocol != ProtocolEmbedding || item.Provider != ProviderPassthrough {
		return errors.New("向量模型仅支持 passthrough + openai_embeddings")
	}
	if item.AdvancedConfig != (AdvancedConfig{}) || item.ImageConfig != nil || item.ImagePricing != nil ||
		item.VideoConfig != nil || item.VideoPricing != nil {
		return errors.New("向量模型不能设置文本、生图或视频配置")
	}
	if len(item.ProviderOptions) > 0 {
		var options map[string]json.RawMessage
		if json.Unmarshal(item.ProviderOptions, &options) != nil || options == nil {
			return errors.New("provider_options 必须是 JSON 对象")
		}
	}
	if item.CreditMultiplier == 0 {
		item.CreditMultiplier = 1
	}
	if item.CreditMultiplier <= 0 {
		return errors.New("credit_multiplier 必须大于 0")
	}
	return nil
}

func validateEmbeddingDimension(dimension int) error {
	if dimension < 1 || dimension > maxEmbeddingDimensions {
		return errors.New("向量维度必须是 1 到 16000 的整数")
	}
	return nil
}
