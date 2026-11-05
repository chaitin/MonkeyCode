package model

import (
	"context"
	"testing"
)

func embeddingInput() SaveInput {
	return SaveInput{
		ModelID:          "text-embedding-3-large",
		DisplayName:      "Embedding Large",
		Kind:             KindEmbedding,
		Protocol:         ProtocolEmbedding,
		Provider:         ProviderPassthrough,
		BaseURL:          "https://api.example.com/v1",
		APIKey:           "secret",
		CreditMultiplier: 1,
		Authorization:    Authorization{AllUsers: true},
	}
}

func embeddingService(repository *repositoryStub, dimension int) *Service {
	return NewService(repository).WithEmbeddingDimensionProbe(func(context.Context, Model) (int, error) {
		return dimension, nil
	})
}

func TestCreateEmbeddingModelAndCatalog(t *testing.T) {
	repository := &repositoryStub{}
	service := embeddingService(repository, 3072).WithKeyAuthenticator(keyAuthenticatorStub{userID: "user-1"})
	item, err := service.Create(t.Context(), "admin-1", embeddingInput())
	if err != nil {
		t.Fatal(err)
	}
	if item.Kind != KindEmbedding || item.Protocol != ProtocolEmbedding || item.EmbeddingConfig == nil || item.EmbeddingConfig.Dimension != 3072 {
		t.Fatalf("向量模型信息错误: %+v", item)
	}
	models, err := service.AgentModels(t.Context(), "user-1")
	if err != nil || len(models) != 1 || models[0].EmbeddingConfig == nil || models[0].EmbeddingConfig.Dimension != 3072 {
		t.Fatalf("向量模型目录错误: %+v, %v", models, err)
	}
	target, err := service.Resolve(t.Context(), "invoke-key", item.ID)
	if err != nil || target.Kind != KindEmbedding || target.EmbeddingConfig == nil || target.EmbeddingConfig.Dimension != 3072 {
		t.Fatalf("向量模型目标错误: %+v, %v", target, err)
	}
}

func TestCreateEmbeddingModelDefaults(t *testing.T) {
	input := embeddingInput()
	input.Provider = ""
	input.CreditMultiplier = 0
	item, err := embeddingService(&repositoryStub{}, 1024).Create(t.Context(), "admin-1", input)
	if err != nil || item.Provider != ProviderPassthrough || item.CreditMultiplier != 1 {
		t.Fatalf("向量模型默认值错误: %+v, %v", item, err)
	}
}

func TestUserEmbeddingModelIsFreeAndKeepsDimension(t *testing.T) {
	input := embeddingInput()
	item, err := embeddingService(&repositoryStub{}, 3072).CreateUser(context.Background(), "owner", UserInput{
		ModelID: input.ModelID, DisplayName: input.DisplayName, Kind: input.Kind,
		Protocol: input.Protocol, Provider: input.Provider,
		BaseURL: input.BaseURL, APIKey: input.APIKey,
	})
	if err != nil || item.CreditMultiplier != 1 || item.EmbeddingConfig == nil || item.EmbeddingConfig.Dimension != 3072 {
		t.Fatalf("用户向量模型配置错误: %+v, %v", item, err)
	}
}

func TestRejectInvalidEmbeddingModel(t *testing.T) {
	cases := []struct {
		name   string
		change func(*SaveInput)
	}{
		{"协议不匹配", func(input *SaveInput) { input.Protocol = ProtocolOpenAIResponses }},
		{"供应商不匹配", func(input *SaveInput) { input.Provider = ProviderOpenAIImages }},
		{"混用文本配置", func(input *SaveInput) { input.AdvancedConfig.ContextWindowTokens = 1024 }},
		{"混用生图配置", func(input *SaveInput) { input.ImageConfig = &ImageConfig{} }},
		{"混用视频配置", func(input *SaveInput) { input.VideoConfig = &VideoConfig{} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := embeddingInput()
			tc.change(&input)
			if _, err := embeddingService(&repositoryStub{}, 1024).Create(t.Context(), "admin-1", input); err == nil {
				t.Fatalf("无效向量模型未被拒绝: %+v", input)
			}
		})
	}
}

func TestEmbeddingDimensionProbeRejectsInvalidDimension(t *testing.T) {
	for _, dimension := range []int{0, maxEmbeddingDimensions + 1} {
		service := embeddingService(&repositoryStub{}, dimension)
		if _, err := service.Create(t.Context(), "admin-1", embeddingInput()); err == nil {
			t.Fatalf("无效探测维度未被拒绝: %d", dimension)
		}
	}
}

func TestValidateEmbeddingDimension(t *testing.T) {
	for _, dimension := range []int{1, 1024, maxEmbeddingDimensions} {
		if err := validateEmbeddingDimension(dimension); err != nil {
			t.Fatalf("有效维度被拒绝: %d, %v", dimension, err)
		}
	}
	for _, dimension := range []int{0, -1, maxEmbeddingDimensions + 1} {
		if err := validateEmbeddingDimension(dimension); err == nil {
			t.Fatalf("无效维度未被拒绝: %d", dimension)
		}
	}
}

func TestUpdateEmbeddingModelReusesStoredKeyForProbe(t *testing.T) {
	repository := &repositoryStub{models: []Model{{
		ID: "model-1", Kind: KindEmbedding, Protocol: ProtocolEmbedding,
		Provider: ProviderPassthrough, ModelID: "text-embedding-3-small",
		DisplayName: "Embedding", BaseURL: "https://api.example.com/v1",
		APIKey: "stored-key", OwnershipType: "system", Enabled: true,
	}}}
	service := NewService(repository).WithEmbeddingDimensionProbe(func(_ context.Context, item Model) (int, error) {
		if item.APIKey != "stored-key" {
			t.Fatalf("探测未复用已保存的密钥: %q", item.APIKey)
		}
		return 1536, nil
	})
	input := embeddingInput()
	input.APIKey = ""
	item, err := service.Update(t.Context(), "model-1", "admin-1", input)
	if err != nil || item.EmbeddingConfig == nil || item.EmbeddingConfig.Dimension != 1536 {
		t.Fatalf("更新时未自动探测维度: %+v, %v", item, err)
	}
}
