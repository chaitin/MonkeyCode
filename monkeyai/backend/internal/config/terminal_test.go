package config

import "testing"

func TestRuntimeTerminalCapabilityRequiresExplicitEnable(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://test")
	for _, tc := range []struct {
		value   string
		want    bool
		invalid bool
	}{
		{"", false, false}, {"false", false, false}, {"true", true, false}, {"invalid", false, true},
	} {
		t.Setenv("MONKEYAI_RUNTIME_TERMINAL_WS", tc.value)
		cfg, err := Load(nil)
		if (err != nil) != tc.invalid || err == nil && cfg.RuntimeTerminalWS != tc.want {
			t.Fatalf("终端开关 %q: %v %v", tc.value, cfg.RuntimeTerminalWS, err)
		}
	}
}
