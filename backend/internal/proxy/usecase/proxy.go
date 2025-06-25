package usecase

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type ProxyUsecase struct {
	repo domain.ProxyRepo
}

func NewProxyUsecase(repo domain.ProxyRepo) domain.ProxyUsecase {
	return &ProxyUsecase{repo: repo}
}

func (p *ProxyUsecase) Record(ctx context.Context, record *domain.RecordParam) error {
	userID, err := uuid.Parse(record.UserID)
	if err != nil {
		return err
	}
	modelID, err := uuid.Parse(record.ModelID)
	if err != nil {
		return err
	}

	return p.repo.Record(ctx, &db.Record{
		UserID:          userID,
		ModelID:         modelID,
		Prompt:          record.Prompt,
		TaskID:          record.TaskID,
		ProgramLanguage: record.ProgramLanguage,
		InputTokens:     record.InputTokens,
		OutputTokens:    record.OutputTokens,
		IsAccept:        record.IsAccept,
		ModelType:       record.ModelType,
		Completion:      record.Completion,
		WorkMode:        record.WorkMode,
		CodeLines:       record.CodeLines,
	})
}

// SelectModelWithLoadBalancing implements domain.ProxyUsecase.
func (p *ProxyUsecase) SelectModelWithLoadBalancing(modelName string, modelType consts.ModelType) (*domain.Model, error) {
	model, err := p.repo.SelectModelWithLoadBalancing(modelName, modelType)
	if err != nil {
		return nil, err
	}
	return cvt.From(model, &domain.Model{}), nil
}

func (p *ProxyUsecase) ValidateApiKey(ctx context.Context, key string) (*domain.ApiKey, error) {
	apiKey, err := p.repo.ValidateApiKey(ctx, key)
	if err != nil {
		return nil, err
	}
	return cvt.From(apiKey, &domain.ApiKey{}), nil
}

func (p *ProxyUsecase) AcceptCompletion(ctx context.Context, req *domain.AcceptCompletionReq) error {
	return p.repo.UpdateByTaskID(ctx, req.ID, func(ruo *db.RecordUpdateOne) {
		ruo.SetIsAccept(true)
		ruo.SetCompletion(req.Completion)
	})
}
