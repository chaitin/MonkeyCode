package model

import (
	"encoding/json"
	"testing"
)

func TestVideoCapabilitiesForTargetModels(t *testing.T) {
	cases := []struct {
		provider Provider
		modelID  string
		mode     VideoMode
		max      int64
	}{
		{ProviderXAI, "grok-imagine-video-1.5", VideoReferenceImageToVideo, 15},
		{ProviderMiniMax, "MiniMax-H3", VideoFirstLastToVideo, 15},
	}
	for _, tc := range cases {
		t.Run(tc.modelID, func(t *testing.T) {
			cap, err := VideoCapabilitiesFor(tc.provider, tc.modelID)
			if err != nil {
				t.Fatal(err)
			}
			if cap.Params[2].Max == nil || *cap.Params[2].Max != tc.max {
				t.Fatalf("duration limit: %+v", cap.Params[2])
			}
			found := false
			for _, mode := range cap.ReferenceModes {
				if mode.Mode == tc.mode {
					found = true
				}
			}
			if !found {
				t.Fatal("目标模式未声明参考角色")
			}
		})
	}
}

func TestVideoParamsRejectUnsupportedModeCombinations(t *testing.T) {
	cap, err := VideoCapabilitiesFor(ProviderXAI, "grok-imagine-video-1.5")
	if err != nil {
		t.Fatal(err)
	}
	config := &VideoConfig{Modes: cap.Modes, Defaults: map[VideoMode]map[string]json.RawMessage{}}
	for _, mode := range cap.Modes {
		config.Defaults[mode] = map[string]json.RawMessage{
			"resolution":       json.RawMessage(`"720p"`),
			"aspect_ratio":     json.RawMessage(`"16:9"`),
			"duration_seconds": json.RawMessage(`6`),
		}
	}
	config.Defaults[VideoImageToVideo]["aspect_ratio"] = json.RawMessage(`"adaptive"`)
	pricing := &VideoPricing{Rates: []VideoResolutionRate{{Resolution: "480p", CreditsPerSecond: "8"},
		{Resolution: "720p", CreditsPerSecond: "14"}, {Resolution: "1080p", CreditsPerSecond: "25"}}}
	item := Model{VideoConfig: config, VideoPricing: pricing}
	if err := ValidateVideoCapabilities(item, cap); err != nil {
		t.Fatal(err)
	}
	_, err = NormalizeVideoParams(config, cap, VideoReferenceImageToVideo, map[string]json.RawMessage{"resolution": json.RawMessage(`"1080p"`)})
	if err == nil {
		t.Fatal("参考图模式不能请求 1080p")
	}
	_, err = NormalizeVideoParams(config, cap, VideoImageToVideo, map[string]json.RawMessage{"aspect_ratio": json.RawMessage(`"16:9"`)})
	if err == nil {
		t.Fatal("首帧模式只能使用自适应比例")
	}
}
