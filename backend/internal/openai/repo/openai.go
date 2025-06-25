package repo

import (
	"context"

	"entgo.io/ent/dialect/sql"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/apikey"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type OpenAIRepo struct {
	db *db.Client
}

func NewOpenAIRepo(db *db.Client) domain.OpenAIRepo {
	return OpenAIRepo{db: db}
}

// GetApiKey implements domain.OpenAIRepo.
func (o OpenAIRepo) GetApiKey(ctx context.Context, key string) (*db.ApiKey, error) {
	return o.db.ApiKey.Query().Where(apikey.Key(key)).Only(ctx)
}

// ModelList implements domain.OpenAIRepo.
func (o OpenAIRepo) ModelList(ctx context.Context) ([]*db.Model, error) {
	return o.db.Model.Query().
		WithUser().
		Where(model.Status(consts.ModelStatusActive)).
		Order(model.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
}
