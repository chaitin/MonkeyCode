package config

import "testing"

func TestTaskflowCallbackTokenFromEnv(t *testing.T) {
	t.Setenv("MCAI_TASKFLOW_CALLBACK_TOKEN", "test-callback-token")

	cfg, err := Init(t.TempDir())
	if err != nil {
		t.Fatalf("Init() error = %v", err)
	}
	if cfg.TaskFlow.CallbackToken != "test-callback-token" {
		t.Fatalf("callback token = %q", cfg.TaskFlow.CallbackToken)
	}
}
