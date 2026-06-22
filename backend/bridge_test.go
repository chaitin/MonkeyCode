package backend

import (
	"context"
	"testing"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type bridgeProductVersionProviderStub struct{}

func (bridgeProductVersionProviderStub) GetProductVersion(context.Context) (domain.ProductVersion, error) {
	return domain.ProductVersion{Edition: domain.ProductEditionPrivate}, nil
}

func TestWithProductVersionProviderRegistersProvider(t *testing.T) {
	injector := do.New()
	provider := bridgeProductVersionProviderStub{}

	WithProductVersionProvider(provider)(injector)

	got := do.MustInvoke[domain.ProductVersionProvider](injector)
	info, err := got.GetProductVersion(context.Background())
	if err != nil {
		t.Fatalf("GetProductVersion: %v", err)
	}
	if info.Edition != domain.ProductEditionPrivate {
		t.Fatalf("edition = %q, want %q", info.Edition, domain.ProductEditionPrivate)
	}
}
