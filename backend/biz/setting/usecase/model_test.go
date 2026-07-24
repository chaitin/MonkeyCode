package usecase

import (
	"context"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestGetProviderModelListMiniMax(t *testing.T) {
	usecase := &modelUsecase{}

	resp, err := usecase.GetProviderModelList(context.Background(), &domain.GetProviderModelListReq{
		Provider: consts.ModelProviderMiniMax,
	})
	if err != nil {
		t.Fatalf("GetProviderModelList() error = %v", err)
	}

	want := []string{"MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2"}
	if len(resp.Models) != len(want) {
		t.Fatalf("model count = %d, want %d", len(resp.Models), len(want))
	}
	for i, model := range resp.Models {
		if model.Model != want[i] {
			t.Fatalf("model %d = %q, want %q", i, model.Model, want[i])
		}
	}
}
