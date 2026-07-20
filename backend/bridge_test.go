package backend

import (
	"context"
	"testing"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type bridgeServerConfigProviderStub struct{}

func (bridgeServerConfigProviderStub) GetServerConfig(context.Context) (domain.ServerConfig, error) {
	return domain.ServerConfig{Edition: domain.ProductEditionPrivate}, nil
}

func TestWithPrivateNetworkBlockedOverridesConfig(t *testing.T) {
	injector := do.New()
	cfg := &config.Config{}
	do.ProvideValue(injector, cfg)

	WithPrivateNetworkBlocked(true)(injector)

	if !cfg.Security.BlockPrivateNetwork {
		t.Fatal("security.block_private_network = false, want true")
	}
}

func TestWithServerConfigProviderRegistersProvider(t *testing.T) {
	injector := do.New()
	provider := bridgeServerConfigProviderStub{}

	WithServerConfigProvider(provider)(injector)

	got := do.MustInvoke[domain.ServerConfigProvider](injector)
	info, err := got.GetServerConfig(context.Background())
	if err != nil {
		t.Fatalf("GetServerConfig: %v", err)
	}
	if info.Edition != domain.ProductEditionPrivate {
		t.Fatalf("edition = %q, want %q", info.Edition, domain.ProductEditionPrivate)
	}
}
