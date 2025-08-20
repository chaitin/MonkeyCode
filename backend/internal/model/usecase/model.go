package usecase

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type ModelUsecase struct {
	logger *slog.Logger
	repo   domain.ModelRepo
	cfg    *config.Config
	client *http.Client
}

func NewModelUsecase(
	logger *slog.Logger,
	repo domain.ModelRepo,
	cfg *config.Config,
) domain.ModelUsecase {
	client := &http.Client{
		Timeout: time.Second * 30,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			MaxConnsPerHost:     100,
			IdleConnTimeout:     time.Second * 30,
		},
	}
	return &ModelUsecase{repo: repo, cfg: cfg, logger: logger, client: client}
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
	return m.repo.List(ctx)
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
	m.logger.With("req", req).With("param", req.Param).DebugContext(ctx, "update model")
	model, err := m.repo.Update(ctx, req.ID, func(tx *db.Tx, old *db.Model, up *db.ModelUpdateOne) error {
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
		if req.APIVersion != nil {
			up.SetAPIVersion(*req.APIVersion)
		}
		if req.APIHeader != nil {
			up.SetAPIHeader(*req.APIHeader)
		}
		if req.ShowName != nil {
			up.SetShowName(*req.ShowName)
		}
		if req.Status != nil {
			if *req.Status == consts.ModelStatusActive {
				if err := tx.Model.Update().
					Where(model.ModelType(old.ModelType)).
					SetStatus(consts.ModelStatusInactive).
					Exec(ctx); err != nil {
					return err
				}
			}
			up.SetStatus(*req.Status)
		}
		if req.Param != nil {
			up.SetParameters(&types.ModelParam{
				R1Enabled:          req.Param.R1Enabled,
				MaxTokens:          req.Param.MaxTokens,
				ContextWindow:      req.Param.ContextWindow,
				SupprtImages:       req.Param.SupprtImages,
				SupportComputerUse: req.Param.SupportComputerUse,
				SupportPromptCache: req.Param.SupportPromptCache,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return cvt.From(model, &domain.Model{}), nil
}

func (m *ModelUsecase) InitModel(ctx context.Context) error {
	m.logger.With("init_model", m.cfg.InitModel).Debug("init model")
	if m.cfg.InitModel.Name == "" {
		return nil
	}
	return m.repo.InitModel(ctx, m.cfg.InitModel.Name, m.cfg.InitModel.Key, m.cfg.InitModel.URL)
}

func (m *ModelUsecase) Delete(ctx context.Context, id string) error {
	return m.repo.Delete(ctx, id)
}
