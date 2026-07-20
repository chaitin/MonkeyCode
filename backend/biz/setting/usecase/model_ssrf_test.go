package usecase

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/netguard"
)

func TestModelUsecaseRejectsPrivateBaseURL(t *testing.T) {
	u := &modelUsecase{guard: netguard.New(true)}

	if _, err := u.Create(context.Background(), uuid.New(), &domain.CreateModelReq{
		BaseURL: "http://127.0.0.1:8080/v1",
	}); err == nil {
		t.Fatal("Create() error = nil")
	}

	if _, err := u.GetProviderModelList(context.Background(), &domain.GetProviderModelListReq{
		Provider: consts.ModelProviderOpenAI,
		BaseURL:  "http://169.254.169.254/latest/meta-data",
	}); err == nil {
		t.Fatal("GetProviderModelList() error = nil")
	}
}

func TestCheckByConfigDoesNotRequestPrivateBaseURL(t *testing.T) {
	guard := netguard.New(true)
	u := &modelUsecase{
		guard:  guard,
		client: guard.HTTPClient(&http.Client{Timeout: time.Second}),
		logger: slog.Default(),
	}
	resp, err := u.CheckByConfig(context.Background(), &domain.CheckByConfigReq{
		BaseURL:       "http://127.0.0.1:8080/v1",
		APIKey:        "secret",
		Model:         "gpt-4o",
		InterfaceType: consts.InterfaceTypeOpenAIChat,
	})
	if err != nil {
		t.Fatalf("CheckByConfig() error = %v", err)
	}
	if resp.Success || !strings.Contains(resp.Error, "private network") {
		t.Fatalf("CheckByConfig() response = %#v", resp)
	}
}
