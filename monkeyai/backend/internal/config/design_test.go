package config

import "testing"

func TestDesignConfigDefaults(t *testing.T) {
	oldSecret := defaultDesignMediaJWTSecret
	t.Cleanup(func() { defaultDesignMediaJWTSecret = oldSecret })
	defaultDesignMediaJWTSecret = "build-secret"
	t.Setenv("MONKEYAI_INSTANCE_ID", "ignored-instance")
	t.Setenv("MONKEYAI_DESIGN_MEDIA_JWT_SECRET", "")
	for _, value := range []string{"", "https://override.example/api/design"} {
		t.Setenv("MONKEYAI_DESIGN_RESPUB_URL", value)
		got := loadDesign()
		if got.DesignRespubURL != "https://hub.monkeycode-ai.com/api/design" {
			t.Fatalf("Hub 地址必须内置，不受环境变量影响: %q", got.DesignRespubURL)
		}
		if got.DesignMediaJWTSecret != "" {
			t.Fatal("显式空环境变量未覆盖编译默认密钥")
		}
	}
	t.Setenv("MONKEYAI_DESIGN_MEDIA_JWT_SECRET", "runtime-secret")
	if got := loadDesign(); got.DesignMediaJWTSecret != "runtime-secret" {
		t.Fatal("运行环境密钥未覆盖编译默认值")
	}
}
