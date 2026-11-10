package model

import (
	"context"
	"errors"
	"strings"
	"time"
)

type EmbeddingResult struct {
	Vector       []float64 `json:"vector"`
	PromptTokens int       `json:"prompt_tokens"`
	TotalTokens  int       `json:"total_tokens"`
}

func (s *Service) EmbedText(ctx context.Context, modelID, input string) (EmbeddingResult, error) {
	item, err := s.repository.Get(ctx, modelID)
	if err != nil {
		return EmbeddingResult{}, err
	}
	if !item.Enabled {
		return EmbeddingResult{}, errors.New("向量模型已禁用")
	}
	if item.Kind != KindEmbedding {
		return EmbeddingResult{}, errors.New("所选模型不是向量模型")
	}
	input = strings.TrimSpace(input)
	if input == "" {
		return EmbeddingResult{}, errors.New("向量输入不能为空")
	}
	payload, err := s.requestEmbedding(ctx, item, input, 30*time.Second)
	if err != nil {
		return EmbeddingResult{}, err
	}
	if len(payload.Data) == 0 || len(payload.Data[0].Embedding) == 0 {
		return EmbeddingResult{}, errors.New("上游响应缺少有效的 embedding 向量")
	}
	dimension := len(payload.Data[0].Embedding)
	for _, item := range payload.Data {
		if len(item.Embedding) != dimension {
			return EmbeddingResult{}, errors.New("上游返回了维度不一致的 embedding 向量")
		}
	}
	if err := validateEmbeddingDimension(dimension); err != nil {
		return EmbeddingResult{}, err
	}
	return EmbeddingResult{
		Vector:       append([]float64(nil), payload.Data[0].Embedding...),
		PromptTokens: payload.Usage.PromptTokens,
		TotalTokens:  payload.Usage.TotalTokens,
	}, nil
}
