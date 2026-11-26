package config

import (
	"strings"
	"testing"
)

func TestAnyDocConfiguration(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://test")
	t.Setenv("MONKEYAI_ANYDOC_URL", "")
	t.Setenv("MONKEYAI_ANYDOC_CALLBACK_BASE_URL", "")
	t.Setenv("MONKEYAI_ANYDOC_SIGNING_KEY", strings.Repeat("k", 32))
	if _, err := Load(nil); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MONKEYAI_ANYDOC_SIGNING_KEY", "")
	cfg, err := Load(nil)
	if err != nil || cfg.AnyDocURL != "http://anydoc:8080" || cfg.AnyDocCallbackBaseURL != "http://backend:8080" || cfg.AnyDocSigningKey != "" {
		t.Fatalf("defaults: %+v %v", cfg, err)
	}
	t.Setenv("MONKEYAI_ANYDOC_URL", "http://custom-anydoc:9090/")
	t.Setenv("MONKEYAI_ANYDOC_CALLBACK_BASE_URL", "https://custom-backend/")
	cfg, err = Load(nil)
	if err != nil || cfg.AnyDocURL != "http://custom-anydoc:9090" || cfg.AnyDocCallbackBaseURL != "https://custom-backend" {
		t.Fatalf("overrides: %+v %v", cfg, err)
	}
	t.Setenv("MONKEYAI_ANYDOC_CALLBACK_BASE_URL", "")
	t.Setenv("MONKEYAI_ANYDOC_URL", "http://anydoc:8080")
	if cfg, err := Load(nil); err != nil || cfg.AnyDocCallbackBaseURL != "http://backend:8080" {
		t.Fatalf("default callback: %q %v", cfg.AnyDocCallbackBaseURL, err)
	}
	t.Setenv("MONKEYAI_ANYDOC_CALLBACK_BASE_URL", "http://backend:8080")
	if _, err := Load(nil); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"file:///tmp/anydoc", "http://user:secret@anydoc", "http://anydoc?token=secret", "http://anydoc#fragment"} {
		t.Setenv("MONKEYAI_ANYDOC_URL", invalid)
		if _, err := Load(nil); err == nil {
			t.Fatalf("accepted %s", invalid)
		}
	}
	t.Setenv("MONKEYAI_ANYDOC_URL", "http://anydoc:8080")
	t.Setenv("MONKEYAI_ANYDOC_SIGNING_KEY", "short")
	if _, err := Load(nil); err == nil {
		t.Fatal("accepted short signing key")
	}
}
