package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type ohMyAgentKeyRepoStub struct {
	domain.ModelRepo
	key *db.ModelApiKey
	err error
}

func (s *ohMyAgentKeyRepoStub) CreateOhMyAgentAPIKey(context.Context, uuid.UUID) (*db.ModelApiKey, error) {
	return s.key, s.err
}

func TestCreateOhMyAgentAPIKeyReturnsSigningSecret(t *testing.T) {
	createdAt := time.Unix(123, 0)
	repo := &ohMyAgentKeyRepoStub{key: &db.ModelApiKey{
		ID:            uuid.New(),
		APIKey:        "oma_key",
		SigningSecret: "omas_secret",
		CreatedAt:     createdAt,
	}}
	usecase := &modelUsecase{repo: repo}

	got, err := usecase.CreateOhMyAgentAPIKey(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != repo.key.ID || got.APIKey != repo.key.APIKey || got.SigningSecret != repo.key.SigningSecret || got.CreatedAt != createdAt.Unix() {
		t.Fatalf("response = %#v", got)
	}
}
