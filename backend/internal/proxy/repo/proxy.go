package repo

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/apikey"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/record"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type ProxyRepo struct {
	db *db.Client
}

func NewProxyRepo(db *db.Client) domain.ProxyRepo {
	return &ProxyRepo{db: db}
}

func (r *ProxyRepo) SelectModelWithLoadBalancing(modelName string, modelType consts.ModelType) (*db.Model, error) {
	ctx := context.Background()
	m, err := r.db.Model.Query().
		Where(model.ModelName(modelName), model.ModelType(modelType)).
		First(ctx)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (r *ProxyRepo) ValidateApiKey(ctx context.Context, key string) (*db.ApiKey, error) {
	a, err := r.db.ApiKey.Query().
		Where(apikey.Key(key), apikey.Status(consts.ApiKeyStatusActive)).
		Only(ctx)
	if err != nil {
		return nil, err
	}
	return a, nil
}

func (r *ProxyRepo) Record(ctx context.Context, record *db.Record) error {
	return r.db.Record.Create().
		SetUserID(record.UserID).
		SetModelID(record.ModelID).
		SetTaskID(record.TaskID).
		SetPrompt(record.Prompt).
		SetProgramLanguage(record.ProgramLanguage).
		SetInputTokens(record.InputTokens).
		SetOutputTokens(record.OutputTokens).
		SetIsAccept(record.IsAccept).
		SetModelType(record.ModelType).
		SetCompletion(record.Completion).
		SetWorkMode(record.WorkMode).
		SetCodeLines(record.CodeLines).
		Exec(ctx)
}

func (r *ProxyRepo) UpdateByTaskID(ctx context.Context, taskID string, fn func(*db.RecordUpdateOne)) error {
	rc, err := r.db.Record.Query().Where(record.TaskID(taskID)).Only(ctx)
	if err != nil {
		return err
	}

	return entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		up := tx.Record.UpdateOneID(rc.ID)
		fn(up)
		return up.Exec(ctx)
	})
}
