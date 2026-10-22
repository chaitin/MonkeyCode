package config

import "testing"

func TestDesignConfigDefaults(t *testing.T) {
	oldURL, oldSecret := defaultDesignRespubURL, defaultDesignMediaJWTSecret
	t.Cleanup(func() { defaultDesignRespubURL = oldURL; defaultDesignMediaJWTSecret = oldSecret })
	defaultDesignRespubURL = "https://hub.example/api/design"
	defaultDesignMediaJWTSecret = "build-secret"
	t.Setenv("MONKEYAI_DESIGN_RESPUB_URL", "")
	t.Setenv("MONKEYAI_DESIGN_MEDIA_JWT_SECRET", "")
	got := loadDesign()
	if got.DesignRespubURL != "" || got.DesignMediaJWTSecret != "" {
		t.Fatal("显式空环境变量未覆盖编译默认值")
	}
	t.Setenv("MONKEYAI_DESIGN_RESPUB_URL", "https://hub.example/custom/design/")
	got = loadDesign()
	if err := validateDesign(&got); err != nil || got.DesignRespubURL != "https://hub.example/custom/design" {
		t.Fatalf("完整base被错误归一化: %+v %v", got, err)
	}
	for _, raw := range []string{"hub.example/api/design", "https://hub.example", "https://user:pass@hub.example/api/design", "https://hub.example/api/design?x=1", "https://hub.example/api/design#frag", "ftp://hub.example/api/design", "https://hub.example/api/../design"} {
		if err := validateDesign(&Design{DesignRespubURL: raw}); err == nil {
			t.Fatal("非法base被接受", raw)
		}
	}
}
