package usecase

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type ModelUsecase struct {
	repo domain.ModelRepo
}

func NewModelUsecase(repo domain.ModelRepo) domain.ModelUsecase {
	return &ModelUsecase{repo: repo}
}

func (m *ModelUsecase) Check(ctx context.Context, req *domain.CheckModelReq) (*domain.Model, error) {
	return nil, nil
}

func (m *ModelUsecase) MyModelList(ctx context.Context, req *domain.MyModelListReq) ([]*domain.Model, error) {
	models, err := m.repo.MyModelList(ctx, req)
	if err != nil {
		return nil, err
	}
	ids := cvt.Iter(models, func(_ int, e *db.Model) uuid.UUID {
		return e.ID
	})
	usages, err := m.repo.ModelUsage(ctx, ids)
	if err != nil {
		return nil, err
	}
	return cvt.Iter(models, func(_ int, e *db.Model) *domain.Model {
		tmp := cvt.From(e, &domain.Model{}).From(e)
		if usage, ok := usages[e.ID]; ok {
			tmp.Input = usage.Input
			tmp.Output = usage.Output
		}
		return tmp
	}), nil
}

func (m *ModelUsecase) List(ctx context.Context) (*domain.AllModelResp, error) {
	return &domain.AllModelResp{
		Providers: []domain.ProviderModel{
			{
				Provider: "百智云",
				Models: []domain.ModelBasic{
					{
						Provider: "百智云",
						Name:     "deepseek-v3",
						APIBase:  "https://model-square.app.baizhi.cloud/v1",
					},
					{
						Provider: "百智云",
						Name:     "deepseek-r1",
						APIBase:  "https://model-square.app.baizhi.cloud/v1",
					},
					{
						Provider: "百智云",
						Name:     "qwen2.5-coder-1.5b-instruct",
						APIBase:  "https://model-square.app.baizhi.cloud/v1",
					},
					{
						Provider: "百智云",
						Name:     "qwen2.5-coder-7b-instruct",
						APIBase:  "https://model-square.app.baizhi.cloud/v1",
					},
				},
			},
			{
				Provider: "DeepSeek",
				Models: []domain.ModelBasic{
					{
						Provider: "DeepSeek",
						Name:     "deepseek-chat",
						APIBase:  "https://api.deepseek.com",
					},
					{
						Provider: "DeepSeek",
						Name:     "deepseek-reasoner",
						APIBase:  "https://api.deepseek.com",
					},
				},
			},
		},
	}, nil
}

// Create implements domain.ModelUsecase.
func (m *ModelUsecase) Create(ctx context.Context, req *domain.CreateModelReq) (*domain.Model, error) {
	model, err := m.repo.Create(ctx, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(model, &domain.Model{}), nil
}

// GetTokenUsage implements domain.ModelUsecase.
func (m *ModelUsecase) GetTokenUsage(ctx context.Context, modelType consts.ModelType) (*domain.ModelTokenUsageResp, error) {
	return m.repo.GetTokenUsage(ctx, modelType)
}

// Update implements domain.ModelUsecase.
func (m *ModelUsecase) Update(ctx context.Context, req *domain.UpdateModelReq) (*domain.Model, error) {
	model, err := m.repo.Update(ctx, req.ID, func(up *db.ModelUpdateOne) {
		if req.ModelName != nil {
			up.SetModelName(*req.ModelName)
		}
		if req.Provider != nil {
			up.SetProvider(*req.Provider)
		}
		if req.APIBase != nil {
			up.SetAPIBase(*req.APIBase)
		}
		if req.APIKey != nil {
			up.SetAPIKey(*req.APIKey)
		}
		if req.Status != nil {
			up.SetStatus(*req.Status)
		}
	})
	if err != nil {
		return nil, err
	}
	return cvt.From(model, &domain.Model{}), nil
}
