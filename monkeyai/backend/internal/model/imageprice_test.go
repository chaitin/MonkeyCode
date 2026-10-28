package model

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestImageRateValidationAndCatalog(t *testing.T) {
	pricing := ImagePricing{Rates: []ImageRate{{Quality: "1K", CreditsPerImage: "0"}, {Quality: "2K", CreditsPerImage: "7.123456"}, {Quality: "4K", CreditsPerImage: "19"}}}
	input := imageInput()
	input.ImagePricing = &pricing
	repo := &repositoryStub{}
	service := NewService(repo)
	created, err := service.Create(t.Context(), "admin", input)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(presentModel(created).ImagePricing)
	if err != nil || strings.Contains(string(encoded), "multiplier") || strings.Contains(string(encoded), "base_credits") {
		t.Fatalf("必须返回独立单张积分: %s, %v", encoded, err)
	}
	catalog, err := service.AgentModels(t.Context(), "admin", true)
	if err != nil || len(catalog) != 1 || !reflect.DeepEqual(catalog[0].ImagePricing.Rates, pricing.Rates) {
		t.Fatalf("目录价格不一致: %+v, %v", catalog, err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*ImagePricing)
	}{
		{"缺失档位", func(p *ImagePricing) { p.Rates = p.Rates[:2] }},
		{"空列表", func(p *ImagePricing) { p.Rates = []ImageRate{} }},
		{"重复档位", func(p *ImagePricing) { p.Rates[2].Quality = "2K" }},
		{"未知档位", func(p *ImagePricing) { p.Rates[2].Quality = "8K" }},
		{"负数", func(p *ImagePricing) { p.Rates[0].CreditsPerImage = "-0.000001" }},
		{"精度过高", func(p *ImagePricing) { p.Rates[0].CreditsPerImage = "0.0000001" }},
		{"金额溢出", func(p *ImagePricing) { p.Rates[0].CreditsPerImage = "1000000000001" }},
		{"混用基础价", func(p *ImagePricing) { p.BaseCreditsPerImage = "10" }},
		{"混用倍率", func(p *ImagePricing) { p.QualityMultipliers = []ImageMultiplier{{Name: "2K", Multiplier: "2"}} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copy := pricing
			copy.Rates = append([]ImageRate{}, pricing.Rates...)
			tc.mutate(&copy)
			input.ImagePricing = &copy
			if _, err := service.Create(t.Context(), "admin", input); err == nil {
				t.Fatal("错误价格不能保存")
			}
		})
	}
}

func TestLegacyImagePricesPresentWithoutMutation(t *testing.T) {
	input := imageInput()
	original, err := json.Marshal(input.ImagePricing)
	if err != nil {
		t.Fatal(err)
	}
	presented := presentModel(Model{ImageConfig: input.ImageConfig, ImagePricing: input.ImagePricing})
	want := []ImageRate{{Quality: "1K", CreditsPerImage: "10"}, {Quality: "2K", CreditsPerImage: "15"}, {Quality: "4K", CreditsPerImage: "30"}}
	if !reflect.DeepEqual(presented.ImagePricing.Rates, want) || presented.ImagePricing.BaseCreditsPerImage != "" || len(presented.ImagePricing.QualityMultipliers) != 0 {
		t.Fatalf("旧价换算错误: %+v", presented.ImagePricing)
	}
	after, _ := json.Marshal(input.ImagePricing)
	if string(after) != string(original) {
		t.Fatal("呈现价格不能改写已有配置")
	}
	p := ImagePricing{BaseCreditsPerImage: "0.000001", QualityMultipliers: []ImageMultiplier{{Name: "1K", Multiplier: "0.5"}}}
	credits, err := p.ImageCredits("1K")
	if err != nil || credits.String() != "0.000001" {
		t.Fatalf("原有舍入规则发生变化: %s %v", credits, err)
	}
	p.BaseCreditsPerImage = "1000000000000"
	p.QualityMultipliers[0].Multiplier = "2"
	if _, err := p.ImageCredits("1K"); err == nil {
		t.Fatal("不能报价溢出积分")
	}
}
