package usecase

import (
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestCreateReqTTLUsesConfiguredSeconds(t *testing.T) {
	cfg := &config.Config{}
	cfg.Task.CreateReqTTLSeconds = 3600

	if got := createReqTTL(cfg); got != time.Hour {
		t.Fatalf("createReqTTL() = %s, want 1h", got)
	}
}

func TestCreateReqTTLFallsBackToDefault(t *testing.T) {
	cfg := &config.Config{}

	if got := createReqTTL(cfg); got != 10*time.Minute {
		t.Fatalf("createReqTTL() = %s, want 10m", got)
	}
}
