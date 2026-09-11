package config

import "testing"

func TestAIGuardConfigFromEnv(t *testing.T) {
	t.Setenv("MCAI_AIGUARD_BASE_URL", "https://aiguard.example.test")
	t.Setenv("MCAI_AIGUARD_API_TOKEN", "test-token")
	t.Setenv("MCAI_AIGUARD_REQUEST_TIMEOUT", "3s")
	t.Setenv("MCAI_AIGUARD_WAIT_TIMEOUT", "4m")
	t.Setenv("MCAI_AIGUARD_POLL_INTERVAL", "250ms")

	cfg, err := Init(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AIGuard.BaseURL != "https://aiguard.example.test" {
		t.Fatalf("base_url = %q", cfg.AIGuard.BaseURL)
	}
	if cfg.AIGuard.APIToken != "test-token" {
		t.Fatalf("api_token = %q", cfg.AIGuard.APIToken)
	}
	if cfg.AIGuard.RequestTimeout != "3s" || cfg.AIGuard.WaitTimeout != "4m" || cfg.AIGuard.PollInterval != "250ms" {
		t.Fatalf("timeouts = request %q wait %q poll %q", cfg.AIGuard.RequestTimeout, cfg.AIGuard.WaitTimeout, cfg.AIGuard.PollInterval)
	}
}

func TestAIGuardConfigDefaults(t *testing.T) {
	t.Setenv("MCAI_AIGUARD_BASE_URL", "")
	t.Setenv("MCAI_AIGUARD_API_TOKEN", "")
	t.Setenv("MCAI_AIGUARD_REQUEST_TIMEOUT", "")
	t.Setenv("MCAI_AIGUARD_WAIT_TIMEOUT", "")
	t.Setenv("MCAI_AIGUARD_POLL_INTERVAL", "")

	cfg, err := Init(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AIGuard.BaseURL != "" || cfg.AIGuard.APIToken != "" {
		t.Fatalf("credentials default = base_url %q token %q", cfg.AIGuard.BaseURL, cfg.AIGuard.APIToken)
	}
	if cfg.AIGuard.RequestTimeout != "10s" || cfg.AIGuard.WaitTimeout != "10m" || cfg.AIGuard.PollInterval != "1s" {
		t.Fatalf("timeouts = request %q wait %q poll %q", cfg.AIGuard.RequestTimeout, cfg.AIGuard.WaitTimeout, cfg.AIGuard.PollInterval)
	}
}
