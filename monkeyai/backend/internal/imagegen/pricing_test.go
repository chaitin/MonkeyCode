package imagegen

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
)

func TestQuote(t *testing.T) {
	item := model.Model{
		Kind: model.KindImage,
		ImageConfig: &model.ImageConfig{
			Qualities: []string{"1K", "2K", "4K"}, AspectRatios: []string{"1:1", "9:16"},
		},
		ImagePricing: &model.ImagePricing{
			BaseCreditsPerImage: "10",
			QualityMultipliers: []model.ImageMultiplier{
				{Name: "2K", Multiplier: "1.5"},
				{Name: "4K", Multiplier: "3"},
			},
		},
	}
	for _, tc := range []struct {
		name, operation, quality, aspect, want string
	}{
		{"基础价格", "generate", "1K", "1:1", "10"},
		{"小数画质倍率", "generate", "2K", "1:1", "15"},
		{"四千画质倍率", "generate", "4K", "1:1", "30"},
		{"比例和操作不调价", "edit", "2K", "9:16", "15"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			amount, err := Quote(item, tc.operation, tc.quality, tc.aspect)
			if err != nil || amount.String() != tc.want {
				t.Fatalf("Quote() = %s, %v; want %s", amount, err, tc.want)
			}
		})
	}
	if _, err := Quote(item, "edit", "8K", "1:1"); err == nil {
		t.Fatal("不能对不支持的画质报价")
	}
	if _, err := Quote(item, "variation", "1K", "1:1"); err == nil {
		t.Fatal("不能对不支持的操作报价")
	}
}

func TestQuoteRoundsOnce(t *testing.T) {
	item := model.Model{
		Kind: model.KindImage,
		ImageConfig: &model.ImageConfig{
			Qualities: []string{"1K"}, AspectRatios: []string{"1:1"},
		},
		ImagePricing: &model.ImagePricing{
			BaseCreditsPerImage: "1",
			QualityMultipliers:  []model.ImageMultiplier{{Name: "1K", Multiplier: "0.333333"}},
		},
	}
	value, err := Quote(item, "generate", "1K", "1:1")
	if err != nil || value.String() != "0.333333" {
		t.Fatalf("定点计算精度错误: %s, %v", value, err)
	}
}
