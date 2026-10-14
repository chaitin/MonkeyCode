package model

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestSeedanceCapabilities(t *testing.T) {
	for _, tc := range []struct {
		modelID       string
		maxSeconds    int64
		maxReferences uint32
		resolutions   []string
	}{
		{"doubao-seedance-2-0-260128", 15, 9, []string{"480p", "720p", "1080p", "4k"}},
		{"doubao-seedance-2-5-260628", 30, 30, []string{"480p", "720p", "1080p"}},
	} {
		t.Run(tc.modelID, func(t *testing.T) {
			cap, err := VideoCapabilitiesFor(ProviderVolcengine, tc.modelID)
			if err != nil {
				t.Fatal(err)
			}
			max, err := VideoMaxDuration(cap)
			if err != nil || max != tc.maxSeconds {
				t.Fatalf("时长上限: %d, %v", max, err)
			}
			if len(cap.Modes) != 4 || slices.Contains(cap.Modes, VideoLastFrameToVideo) {
				t.Fatalf("不支持的模式: %v", cap.Modes)
			}
			for _, spec := range cap.References {
				if spec.MinWidth != 300 || spec.MaxHeight != 6000 || spec.MinAspectRatio != "0.4" || spec.MaxAspectRatio != "2.5" {
					t.Fatalf("图片约束: %+v", spec)
				}
				if spec.Role == "reference_image" && spec.MaxCount != tc.maxReferences {
					t.Fatalf("参考图片上限: %d", spec.MaxCount)
				}
			}
			config := &VideoConfig{Modes: cap.Modes, Defaults: map[VideoMode]map[string]json.RawMessage{}}
			for _, mode := range cap.Modes {
				config.Defaults[mode] = map[string]json.RawMessage{
					"resolution": json.RawMessage(`"720p"`), "aspect_ratio": json.RawMessage(`"adaptive"`),
					"duration_seconds": json.RawMessage(`6`), "generate_audio": json.RawMessage(`true`),
				}
			}
			pricing := &VideoPricing{}
			for _, resolution := range tc.resolutions {
				pricing.Rates = append(pricing.Rates, VideoResolutionRate{Resolution: resolution, CreditsPerSecond: "14"})
			}
			input := SaveInput{Kind: KindVideo, Protocol: ProtocolVideo, Provider: ProviderVolcengine,
				ModelID: tc.modelID, DisplayName: "Seedance", BaseURL: "https://ark.cn-beijing.volces.com/api/v3", APIKey: "secret",
				VideoConfig: config, VideoPricing: pricing, Authorization: Authorization{UserIDs: []string{"user-1"}},
			}
			if _, err := NewService(&repositoryStub{}).Create(t.Context(), "admin-1", input); err != nil {
				t.Fatal(err)
			}
			price := userVideoPricing(KindVideo, ProviderVolcengine, tc.modelID, config)
			if err := ValidateVideoCapabilities(Model{VideoConfig: config, VideoPricing: price}, cap); err != nil {
				t.Fatalf("个人模型定价: %v", err)
			}
			for _, mode := range cap.Modes {
				if VideoPromptRequired(cap, mode, config.Defaults[mode]) != (mode == VideoTextToVideo) {
					t.Fatalf("模式 %s 的提示词规则错误", mode)
				}
			}
			for _, seconds := range []int64{4, tc.maxSeconds} {
				raw, _ := json.Marshal(seconds)
				if _, err := NormalizeVideoParams(config, cap, VideoTextToVideo, map[string]json.RawMessage{"duration_seconds": raw}); err != nil {
					t.Fatal(err)
				}
			}
			for _, seconds := range []int64{-1, 3, tc.maxSeconds + 1} {
				raw, _ := json.Marshal(seconds)
				if _, err := NormalizeVideoParams(config, cap, VideoTextToVideo, map[string]json.RawMessage{"duration_seconds": raw}); err == nil {
					t.Fatalf("不应接受时长 %d", seconds)
				}
			}
			if _, err := NormalizeVideoParams(config, cap, VideoImageToVideo, map[string]json.RawMessage{"generate_audio": json.RawMessage(`false`)}); err != nil {
				t.Fatal(err)
			}
			if _, err := NormalizeVideoParams(config, cap, VideoImageToVideo, map[string]json.RawMessage{"generate_audio": json.RawMessage(`"false"`)}); err == nil {
				t.Fatal("音频开关必须是布尔值")
			}
			for _, mode := range []VideoMode{VideoImageToVideo, VideoFirstLastToVideo} {
				_, err := NormalizeVideoParams(config, cap, mode, map[string]json.RawMessage{"aspect_ratio": json.RawMessage(`"16:9"`)})
				if (err != nil) != (tc.maxSeconds == 30) {
					t.Fatalf("首帧比例规则错误: %v", err)
				}
			}
			_, err = NormalizeVideoParams(config, cap, VideoTextToVideo, map[string]json.RawMessage{"resolution": json.RawMessage(`"4k"`)})
			if (err != nil) != (tc.maxSeconds == 30) {
				t.Fatalf("4k 规则错误: %v", err)
			}
		})
	}
	for _, tc := range []struct {
		provider Provider
		modelID  string
	}{
		{ProviderXAI, "doubao-seedance-2-0-260128"},
		{ProviderVolcengine, "doubao-seedance-2-5-unknown"},
		{ProviderVolcengine, "doubao-seedream-5-0-pro-260628"},
	} {
		if _, err := VideoCapabilitiesFor(tc.provider, tc.modelID); err == nil {
			t.Fatalf("不应允许型号 %s / %s", tc.provider, tc.modelID)
		}
	}
}
