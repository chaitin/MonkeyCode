package model

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func imageInput() SaveInput {
	return SaveInput{
		ModelID:     "gpt-image-2.5-sunburst",
		DisplayName: "生图模型",
		Kind:        KindImage,
		Protocol:    ProtocolImage,
		Provider:    ProviderOpenAIImages,
		BaseURL:     "https://api.example.com/v1",
		APIKey:      "secret",
		ImageConfig: &ImageConfig{
			Qualities:          []string{"1K", "2K"},
			AspectRatios:       []string{"1:1", "9:16"},
			DefaultQuality:     "2K",
			DefaultAspectRatio: "1:1",
		},
		ImagePricing:  &ImagePricing{BaseCreditsPerImage: "10", QualityMultipliers: []ImageMultiplier{{Name: "2K", Multiplier: "2"}}},
		Authorization: Authorization{AllUsers: true},
	}
}

func TestCreateImageModelAndCatalog(t *testing.T) {
	repository := &repositoryStub{}
	service := NewService(repository).WithKeyAuthenticator(keyAuthenticatorStub{userID: "user-1"})
	model, err := service.Create(t.Context(), "admin-1", imageInput())
	if err != nil {
		t.Fatal(err)
	}
	if model.Kind != KindImage || model.Provider != ProviderOpenAIImages || model.CreditMultiplier != 1 {
		t.Fatalf("生图模型信息错误: %+v", model)
	}
	items, err := service.AgentModels(t.Context(), "user-1", false)
	if err != nil || len(items) != 1 || items[0].Kind != KindImage || items[0].ImageConfig.DefaultQuality != "2K" || items[0].ImagePricing.BaseCreditsPerImage != "10" {
		t.Fatalf("生图目录错误: %+v, %v", items, err)
	}
	target, err := service.Resolve(t.Context(), "invoke-key", model.ID)
	if err != nil || target.Kind != KindImage || target.Provider != ProviderOpenAIImages {
		t.Fatalf("生图目标错误: %+v, %v", target, err)
	}
}

func TestImageCapabilitiesRestrictAdminConfigAndCatalog(t *testing.T) {
	service := NewService(&repositoryStub{}).WithImageCapabilities(func(provider Provider, upstream string) (ImageCapabilities, error) {
		if provider != ProviderOpenAIImages || upstream != "gpt-image-2.5-sunburst" {
			t.Fatal("错误的供应商能力查询")
		}
		return ImageCapabilities{Operations: []string{"generate", "edit"},
			Qualities: []string{"1K", "2K"}, AspectRatios: []string{"1:1", "9:16"},
			MaxImages: 4, MaxReferenceImages: 4, SupportsMask: true}, nil
	})
	input := imageInput()
	input.ImageConfig.AspectRatios = []string{"21:9"}
	if _, err := service.Create(t.Context(), "admin-1", input); err == nil {
		t.Fatal("不支持的比例被管理员配置")
	}
	input = imageInput()
	if _, err := service.Create(t.Context(), "admin-1", input); err != nil {
		t.Fatal(err)
	}
	models, err := service.AgentModels(t.Context(), "user-1", false)
	if err != nil || len(models) != 1 {
		t.Fatalf("生图目录缺失: %v %v", models, err)
	}
	body, err := json.Marshal(models[0])
	if err != nil || !strings.Contains(string(body), `"max_images":4`) || !strings.Contains(string(body), `"default_quality":"2K"`) {
		t.Fatalf("缺少动态能力: %s, %v", body, err)
	}
}

func TestRejectInvalidImageModel(t *testing.T) {
	cases := []struct {
		name   string
		change func(*SaveInput)
	}{
		{"协议不匹配", func(i *SaveInput) { i.Protocol = ProtocolOpenAIChat }},
		{"未指定适配器", func(i *SaveInput) { i.Provider = ProviderPassthrough }},
		{"未知适配器", func(i *SaveInput) { i.Provider = Provider("other") }},
		{"缺失生图配置", func(i *SaveInput) { i.ImageConfig = nil }},
		{"缺失价格", func(i *SaveInput) { i.ImagePricing = nil }},
		{"非法画质", func(i *SaveInput) { i.ImageConfig.Qualities = []string{"2K", "2K"} }},
		{"非法比例", func(i *SaveInput) { i.ImageConfig.AspectRatios = []string{"33:32"} }},
		{"默认比例不在列表", func(i *SaveInput) { i.ImageConfig.DefaultAspectRatio = "16:9" }},
		{"价格含浮点溢出", func(i *SaveInput) { i.ImagePricing.BaseCreditsPerImage = "1.0000001" }},
		{"倍率名称不在列表", func(i *SaveInput) { i.ImagePricing.QualityMultipliers[0].Name = "8K" }},
		{"负倍率", func(i *SaveInput) { i.ImagePricing.QualityMultipliers[0].Multiplier = "-1" }},
		{"文本 Token 配置", func(i *SaveInput) { i.AdvancedConfig.MaxOutputTokens = 100 }},
		{"无效 ProviderOptions", func(i *SaveInput) { i.ProviderOptions = []byte(`{"region":`) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := imageInput()
			tc.change(&input)
			if _, err := NewService(&repositoryStub{}).Create(t.Context(), "admin-1", input); err == nil {
				t.Fatal("无效生图配置未被拒绝")
			}
		})
	}
}

func TestTextModelStillDefaultsToText(t *testing.T) {
	item, err := NewService(&repositoryStub{}).Create(t.Context(), "admin-1", validInput())
	if err != nil || item.Kind != KindText || item.Provider != ProviderPassthrough || item.ImageConfig != nil {
		t.Fatalf("文本默认值错误: %+v, %v", item, err)
	}
}

func TestUserImageModelIsFree(t *testing.T) {
	input := imageInput()
	item, err := NewService(&repositoryStub{}).CreateUser(context.Background(), "owner", UserInput{
		Kind: input.Kind, Provider: input.Provider, Protocol: input.Protocol,
		ModelID: input.ModelID, DisplayName: input.DisplayName, BaseURL: input.BaseURL,
		APIKey: input.APIKey, ImageConfig: input.ImageConfig,
	})
	if err != nil || item.ImagePricing == nil || item.ImagePricing.BaseCreditsPerImage != "0" {
		t.Fatalf("用户自带模型不应收取平台积分: %+v, %v", item, err)
	}
}

func TestMarshalImageFields(t *testing.T) {
	options, config, pricing, err := marshalImageFields(Model{})
	if err != nil || string(options) != "{}" || config != nil || pricing != nil {
		t.Fatalf("文本模型不应持久化生图配置: %q, %q, %q, %v", options, config, pricing, err)
	}
}
