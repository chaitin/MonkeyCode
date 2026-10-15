package model

import (
	"encoding/json"
	"testing"
)

func TestAgnesVideoCapabilities(t *testing.T) {
	cap, err := VideoCapabilitiesFor(ProviderAgnes, "agnes-video-2.5")
	if err != nil {
		t.Fatal(err)
	}
	if len(cap.Modes) != 4 || len(cap.Params) != 3 || string(cap.Params[0].Choices[0]) != `"720P"` {
		t.Fatalf("Agnes 视频能力错误: %+v", cap)
	}
	if max, err := VideoMaxDuration(cap); err != nil || max != 12 {
		t.Fatalf("Agnes 视频时长上限错误: %d, %v", max, err)
	}
	if cap.References[2].MaxCount != 8 || !VideoPromptRequired(cap, VideoFirstLastToVideo, map[string]json.RawMessage{}) {
		t.Fatalf("Agnes 视频参考或提示词规则错误: %+v", cap)
	}
	if _, err := VideoCapabilitiesFor(ProviderAgnes, "other-model"); err == nil {
		t.Fatal("不应接受未知 Agnes 视频型号")
	}
}
